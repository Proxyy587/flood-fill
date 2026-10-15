# ARCHITECTURE

## Implementation status (AK, 2026-10-15)

The architecture below is the target. src/contracts now contains frozen types,
schemas and labelled mocks; src/sim contains a pure grid, RNG, navigation, weather,
flood/power, seeded typed-array NPC/car tables, commuting/traffic and headless runner.
Browser timing, transfer, rendering, UI, evacuation, reports, rescue dispatch,
aircraft, replay and critic integration are pending.

`createSimulation(scenario,seed,mode,options)` exposes tick/done/navVersion, step,
snapshot, summary and inspect(selection). `runBatch(scenario,seeds,mode,options?)`
runs the same core. Inspector data and entity snapshot arrays are detached copies.
Snapshots own copied buffers; transfer cannot detach the world. The worker adapter
will live outside src/sim so the pure core never imports host APIs.

State 0 applies any tick-0 faults before initial power propagation. Step samples
weather/sources on [tick,tick+1), applies flood, scheduled faults and power at
boundary tick+1, then derives closures and steps agents/traffic. Metrics include 0,
every 10 ticks and the final state. RUN_STARTED declares dispatchImplemented:false.
Mode labels do not select rescue policies yet. Population uses its own seeded
stream; no wall-clock input affects outcomes. Foot destination and car-origin flow
fields are shared across same-tick route requests. Routes keep fractional edge
progress; replanning waits for a node and never resets a partially travelled edge.
Car destination access minimizes walking/driving ETA including current BPR costs.
Failed cars obstruct roads; traffic uses deterministic rotating agent priority,
throughput credits and sustained connected queue episodes, not lane/headway physics.
Planning is resource-bounded: at most 49,152 grid-cell flow-search units and 256
plan attempts per tick; deterministic FIFO caches hold at most 16 fields per mode
(6 MiB combined at 128x128). Retained route cells plus mode entries total at most
262,144. Excess requests queue for later ticks rather than allocating without bound.
These are deterministic work/allocation bounds, not proof of the 8ms tick target.

Power edges are undirected; trips latch until a future repair action. Hospitals
use generators until fuel exhaustion or interior flooding. Physics is synthetic;
see SIM_SPEC.md for current constants and limitations.

Static ESLint guards reject host imports/APIs, clocks, randomness and runtime
import escapes in src/sim. They do not audit transitive third-party dependencies.

## 1. Big picture

```
 ┌───────────────┐  EditCommand   ┌──────────────────────────┐
 │  Editor / UI  │ ─────────────► │                          │
 │ (React, Zustand)               │   Sim Worker (pure TS)   │
 └───────▲───────┘                │  world · weather · flood │
         │ UiState                │  power · nav · agents    │
         │                        │  dispatch · metrics      │
 ┌───────┴───────┐ RenderSnapshot │                          │
 │ three.js      │ ◄───────────── │   ──► SimEvent log       │
 │ renderer      │   (per tick)   └───────────┬──────────────┘
 └───────────────┘                            │ events + metrics
                                              ▼
                              ┌──────────────────────────┐
                              │ Replay · Dashboard · AI  │
                              │ critic (Next route)      │
                              └──────────────────────────┘
```

Two hard boundaries:

- **Sim ⟷ everything else** goes through typed messages. The sim never knows the renderer exists.
- **Browser ⟷ LLM** goes through `app/api/critic`, so the API key stays server-side.

## 2. Worker protocol (`src/contracts/messages.ts`)

Main → Worker: `load(scenario, seed, options)`, `play`, `pause`, `setSpeed(n)`, `edit(EditCommand)` (editor mode only), `inject(InjectedEvent)`, `setNpcParams(NpcParams)`, `setDispatchMode('negotiation' | 'centralised')`, `seek(tick)` (replay), `exportLog`.

Worker → Main: `snapshot(RenderSnapshot)` at up to 20 Hz, `events(SimEvent[])` batched, `metrics(MetricsFrame)` once per 10 ticks, `done(RunSummary)`.

Snapshots use **transferable typed arrays** (positions, headings, states, water depth) to avoid worker-message cloning. They must own their buffers; the current core copies world data before transfer. Entity metadata (names, assignments, reasons) is fetched on demand: `inspect({entityKind,id}) → InspectorData`.

## 3. Tick pipeline (fixed order, every tick)

1. **Weather**: advance rain intensity, wind; spawn flood sources (river overflow, flash burst).
2. **Flood**: shallow-water cellular update; drainage removal; evaporation/soak.
3. **Power**: recompute energised nodes from the grid graph; flooded substations trip; cascading blackouts turn traffic signals into 4-way stops; unpowered pumps throttle; hospital backup generators engage and drain fuel.
4. **Hazard map**: derive passability per mode (foot, car, boat, air) from depth, power (unpowered signals), blockages, wind gusts (helicopter no-fly). Mark changed edges and bump `navVersion` if anything crossed a threshold.
5. **Perception**: each agent updates its *belief* (see §5). Reports are generated with delay and noise.
6. **Decisions**: NPC behaviour, dispatch (negotiation or centralised), hospital balancing with generator/power checks, helicopter rooftop rescue and medevac tasking.
7. **Movement**: agents advance along paths with speed modifiers (depth, congestion, panic).
8. **Invariants + metrics**: check invariants (safe operating limits, no double-allocated helicopter seats/beds, zero unpowered hospitals without generator), append metrics.
9. **Emit**: events, snapshot.

Order matters because of determinism. Do not reorder without an ADR in `docs/CHANGELOG.md`.

## 4. World model (`src/sim/world`)

Structure-of-arrays over `W × H` cells:

| Array | Type | Meaning |
|---|---|---|
| `ground` | `Uint8Array` | terrain height in voxels |
| `block` | `Uint8Array` | `BlockType` enum |
| `buildingId` | `Int32Array` | 0 = none, else branded BuildingId (not a table offset) |
| `water` | `Float32Array` | water depth above ground (voxels, fractional) |
| `flow` | `Float32Array ×4` | outflow to N/E/S/W (virtual-pipe solver state) |
| `power` | `Uint8Array` | 0 unpowered, 1 powered, 2 generator |
| `occupancy` | spatial hash | agents per cell for crowding and congestion |

Buildings are multi-cell footprints with a table entry: type, capacity, current load, power node, entrances, rooftop-accessible flag.

## 5. Partial information (this is what makes it "agents", not a script)

- **Ground truth** is the world arrays.
- Each agent holds a **belief**: last-seen depth per cell, last-known closures, reported incidents with `confidence` and `age`. Agents see only within a radius, plus what radio, phone or reports tell them.
- **Police/Flood HQ** holds an aggregated map built from reports. Reports are delayed, noisy and sometimes wrong (false reports, duplicates).
- Beliefs decay. Stale closures are re-verified and cost a "confidence penalty" in routing.
- UI toggle: **Truth view** vs **HQ belief view**. This is the best explainer for the judges.

## 6. Navigation (`src/sim/nav`)

- Per-mode graphs over the grid: `foot`, `car`, `boat`, `air` (air is straight-line plus no-fly cells).
- **A\*** with a heap for individual routes (ambulance to hospital, boat to victim).
- **Flow fields (Dijkstra from targets)** for crowds: evacuate-to-shelter and go-to-work. One field per target class, recomputed lazily when `navVersion` changes. This is what makes 1000 civilians affordable.
- Edge cost = `length / speed(mode, depth) * (1 + congestion) + closurePenalty + uncertaintyPenalty`.
- Congestion uses a BPR-style curve: `t = t0 * (1 + 0.15 * (flow/capacity)^4)`.
- **Replanning**: agents hold `pathVersion`. When `navVersion` changes and the next N steps of their path are affected, they replan, and emit a `REROUTE` event with the cause (e.g. "cell (41,17) depth 0.6 > car limit 0.3").

## 7. Rendering contract (`src/render`)

- Terrain as chunked meshes (16×16 cells) with hidden-face culling. Only dirty chunks rebuild.
- Water as a separate translucent surface per chunk, vertex heights from `ground + water`. Depth drives colour.
- Entities as `InstancedMesh` per model type. Positions are interpolated between the last two snapshots.
- Camera modes: `overview` (orbit), `focus(id)`, `follow(id)`, `cinematic` (optional). Picking by GPU colour-ID or raycast against instance bounds.
- Day/night and rain particles are cosmetic and must never feed back into the sim.

## 8. Headless mode

`scripts/batch.ts` imports `src/sim` directly in Node, runs N seeds × {negotiation, centralised} on a scenario, and writes `out/metrics-*.json`. The dashboard's comparison view and the AI critic both consume these files. This is how we show "negotiation reduced mean time-to-service by X% over 30 seeds".

## 9. Performance budget

- Default grid 96×96 (max 128×128). 600 civilians + 80 vehicles default, 1500 + 200 stress.
- Sim tick ≤ 8 ms at default size on a laptop; renderer ≥ 50 fps.
- If over budget, in this order: lower flood solver frequency (every 2nd tick), reduce chunk rebuild rate, cap decision frequency per agent (stagger by `id % 8`).

## 10. Persistence

- Scenarios: JSON, validated by Zod, versioned with `schemaVersion`.
- Runs: `{scenario, seed, options, events[], metrics[]}` JSON. Replay re-simulates from the seed and the event log, or loads recorded snapshots at keyframes every 60 ticks.
- Local only (IndexedDB or downloads). No backend database.

## 11. Architecture addendum — bounded agent decisions with Laya (2026-10-15)

**Status: proposed design and migration plan; not an implemented runtime feature.** Initial feasibility/cost findings: [LAYA_FEASIBILITY.md](LAYA_FEASIBILITY.md). Ordered code migration and acceptance gates: [LAYA_MIGRATION_PLAN.md](LAYA_MIGRATION_PLAN.md).

### Responsibilities and boundaries

Add an optional decision provider that chooses among a small, simulator-generated action set. The initial experiment is hospital selection; subsequent candidates include report verification, evacuation choices, and dispatch bidding. The provider never writes world arrays, creates arbitrary routes, reserves capacity, or bypasses safety rules.

```text
Sim belief + feasible candidates
  → typed worker request → main-thread broker → Next server route
  → local Laya inference service → validated typed result
  → sim freshness/safety gate → atomic commit OR deterministic fallback
  → decision tape + event/inspector evidence
```

`src/sim` stays pure and contains observation/candidate construction, deterministic scoring, admission checks, and commit logic. SDK and HTTP calls live outside it. `src/render` continues to consume worker snapshots faithfully. Existing navigation/physics defects must be fixed in the sim; rendering a pedestrian beside its actual path does not fix its behaviour.

Use a new server route, proposed as `app/api/agent-decisions`, for in-run provider calls. The existing `app/api/critic` remains the after-run explanation/proposal boundary. A local inference process is an optional new runtime component; this does not require replacing Next.js or three.js. Default operation and offline demos remain rules-only.

### Decision ordering and safety

The nine-stage tick pipeline above is unchanged. During the decision stage, process queued, eligible results in stable order, recheck navigation and resource versions, and reserve resources atomically before movement. No async callback mutates a live sim state. Reject out-of-set actions, expired requests, replies from old run generations, invalid/truncated evidence, and resource conflicts. A timeout, low-confidence/unevaluated result, exhausted budget, or unavailable model falls back with a recorded reason.

Candidate observations use the agent's partial information. Ground truth remains authoritative for preventing unsafe execution, but must not leak into a decentralised agent's policy input. The centralised baseline's visibility remains an explicit experiment setting. Model probabilities are evidence, not proof of safety or permission to act.

### Replay and reproducibility amendment

Rules-only determinism remains unchanged. An assisted run has an additional external input: the decision tape. Record request/observation/candidate hashes, model and calibration revisions, raw proposal, gate outcome, committed action, and applied tick. The reproducibility claim becomes **same scenario + seed + sim/policy versions + recorded external inputs and decision tape = identical replay**. Fresh online inference is not promised to reproduce from a seed alone.

Interactive runs may use results available at a future tick or fall back; controlled evaluation may hold sim advancement at a decision boundary. Both record the realised outcome and replay without contacting Laya. The renderer stays responsive while a controlled run waits.

### Rollout and scale

Keep decision policy orthogonal to `dispatchMode`: negotiation and centralised dispatch remain available. Progress from rules → shadow evaluation → one bounded assisted slice. Model requests are event-triggered, shortlisted, batched, and capped; ordinary steering, water flow, traffic safety, and immediate replanning never depend on inference availability. Retain the existing tick/frame performance budgets and measure inference separately.

This addendum authorises architectural planning, not a claim of validated emergency-decision capability. Synthetic-data and human-accepted city-patch rules remain in force. Real-city replication is separate future scope.
