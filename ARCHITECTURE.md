# ARCHITECTURE

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

Snapshots use **transferable typed arrays** (positions, headings, states, water depth) to avoid copies. Entity metadata (names, assignments, reasons) is fetched on demand when the inspector selects something: `inspect(id) → InspectorData`.

## 3. Tick pipeline (fixed order, every tick)

1. **Weather**: advance rain intensity, wind; spawn flood sources (river overflow, flash burst).
2. **Flood**: shallow-water cellular update; drainage removal; evaporation/soak.
3. **Power**: recompute energised nodes from the grid graph; flooded substations trip; generators drain fuel.
4. **Hazard map**: derive passability per mode (foot, car, boat, air) from depth, power (signals), blockages. Mark changed edges and bump `navVersion` if anything crossed a threshold.
5. **Perception**: each agent updates its *belief* (see §5). Reports are generated with delay and noise.
6. **Decisions**: NPC behaviour, dispatch (negotiation or centralised), hospital balancing, helicopter tasking.
7. **Movement**: agents advance along paths with speed modifiers (depth, congestion, panic).
8. **Invariants + metrics**: check invariants, append metrics.
9. **Emit**: events, snapshot.

Order matters because of determinism. Do not reorder without an ADR in `CHANGELOG.md`.

## 4. World model (`src/sim/world`)

Structure-of-arrays over `W × H` cells:

| Array | Type | Meaning |
|---|---|---|
| `ground` | `Uint8Array` | terrain height in voxels |
| `block` | `Uint8Array` | `BlockType` enum |
| `buildingId` | `Uint16Array` | 0 = none, else index into building table |
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
