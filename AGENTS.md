<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
# AGENTS.md — FloodSim (Code-E-Manipal 2.0, PS 27 + city-planning sandbox)

Read this file fully before touching anything. Then read your own `workers/WORKER_*.md`.

## 1. What we are building

A **2.5D voxel city sandbox** in the browser.

1. **Edit** a city on a grid: roads, houses, hospitals, police/flood-HQ, boat depots, drainage, trees, terrain, power grid, helipads.
2. **Run** it. The city is alive: civilians commute, cars drive, staff work. Then weather worsens: rain, a river overflow or a flash flood. Water pools, roads close, power fails.
3. **Watch** from above, with focus/follow on any person, vehicle or building.
4. **Critique**: an AI critic reads the run's metrics and event log and proposes improvements (new roads, hospital placement, drainage, traffic control). We **re-run the proposed change in the sim to verify it**. The LLM proposes, the simulator proves.

Problem-statement mapping (Flood Rescue Dispatch, PS 27). Judges will look for these, so they are never cut:

| PS requirement | Where it lives |
|---|---|
| Agents with partial information, resource contention, urgency | `src/sim/agents`, `src/sim/dispatch` |
| Dynamic re-planning on a changing road/water graph | `src/sim/nav` |
| Uncertainty-tagged reports | `src/sim/reports` |
| Capacity constraints, fairness, explicit safety invariants | `src/sim/invariants`, `src/sim/metrics` |
| Decentralised negotiation vs **centralised baseline** | `src/sim/dispatch/{negotiation,centralised}.ts` |
| Time to service, unmet requests, idle time, route violations, fairness, recovery | `src/sim/metrics` |
| Simultaneous bridge closure + boat failure + shelter overflow + blackout + helicopter grounding | `scenarios/stress-*.json` |
| Time-stepped sim, injected events, assignment log, reroute explanation, after-action replay | event log + `src/ui/replay` |
| Synthetic data only, no live feeds | everything is generated |

## 2. Stack

- **Next.js (App Router) + TypeScript (strict)**
- **three.js** (plain, not react-three-fiber) mounted in a client-only component
- **Sim runs in a Web Worker**, never on the main thread
- **Zustand** for UI state, **Zod** for schema validation, **Vitest** for tests
- **Chart.js** (or Recharts) for metrics
- Anthropic API called **only from a Next.js route handler** (`app/api/critic`), never from the browser

## 3. The five rules that stop us breaking each other

1. **`src/sim` is pure.** No imports from `react`, `next`, `three`, `window`, `document`. It must run in Node for headless batch runs.
2. **The sim is deterministic.** Seeded RNG only (`src/sim/rng.ts`). `Math.random()` and `Date.now()` are banned inside `src/sim`. Same scenario + same seed = identical event log. A lint rule enforces this.
3. **The renderer only reads state.** `src/render` consumes `RenderSnapshot` from the worker and never mutates sim state. The editor changes the world only through `EditCommand`s.
4. **Contracts first.** Types in `src/contracts/` are the only shared surface. Changing a contract needs AK or AJ's approval and a note in `docs/CHANGELOG.md`.
5. **Stay in your lane.** Edit only the folders your worker file lists. If you need something elsewhere, write a request in `docs/REQUESTS.md` and carry on with a mock.

## 4. Repo layout

```
floodsim/
├─ AGENTS.md
├─ docs/                  ARCHITECTURE, SIM_SPEC, CONTRACTS, AI_CRITIC, ROADMAP, CHANGELOG, REQUESTS
├─ workers/               one brief per worker
├─ scenarios/             *.json city templates (validated by Zod)
├─ scripts/               headless runs: batch.ts, compare.ts, validate-scenarios.ts
├─ src/
│  ├─ contracts/          types + Zod schemas (shared, frozen-ish)
│  ├─ sim/                PURE TypeScript simulation (AK)
│  │  ├─ world/           grid, blocks, buildings
│  │  ├─ weather/         rain timeline, sources
│  │  ├─ flood/           water solver, drainage
│  │  ├─ power/           grid graph, outages
│  │  ├─ nav/             pathfinding, flow fields, closures
│  │  ├─ agents/          NPC roles, attributes, behaviour
│  │  ├─ dispatch/        negotiation, centralised baseline, hospital balancing
│  │  ├─ aircraft/        helicopters
│  │  ├─ reports/         uncertain incident reports
│  │  ├─ metrics/ invariants/ events/
│  │  └─ index.ts         pure API shared by headless and browser adapters
│  ├─ worker/             browser timing/postMessage adapter (AJ, outside pure sim)
│  ├─ render/             three.js scene, chunks, water, instanced entities (AJ)
│  ├─ editor/             tools, hotbar, undo/redo, save/load (Worker 2)
│  ├─ ui/                 panels: NPC sliders, inspector, replay, dashboard (Workers 2, 3)
│  ├─ ai/                 critic client, prompt builders, patch applier (Worker 3)
│  └─ assets/             voxel models, palette (Worker 1)
└─ app/                   Next.js routes; page.tsx just mounts <FloodSimApp/>
```

## 5. Commands

```
pnpm dev            # next dev
pnpm test           # vitest (sim tests run in node)
pnpm sim:batch      # scripts/batch.ts: N seeds, writes metrics JSON
pnpm sim:compare    # negotiation vs centralised baseline over N seeds
pnpm validate       # Zod-validate every scenarios/*.json
pnpm lint           # eslint incl. sim-purity + determinism rules
```

## 6. Conventions

- Grid coordinates are `(x, z)` with `y` as height, matching three.js. Cell index `i = z * W + x`.
- 1 cell = 1 voxel footprint = 4 m. 1 voxel of height = 1 m. Say so in any UI that shows units.
- 1 sim tick = 1 simulated second. The renderer interpolates between ticks. Speed multipliers (1x, 4x, 16x) change ticks per wall-second.
- IDs are branded positive integers (`NpcId`, `VehicleId`, `BuildingId`, `RequestId`), matching the frozen contracts and Int32Array snapshots. Validate raw JSON IDs at the boundary.
- Every sim decision that matters emits an `SimEvent` with a human-readable `reason`.
- Hot loops use typed arrays (`Float32Array`, `Uint8Array`), not arrays of objects.
- No `any`. No default exports except Next.js pages/layouts and tool configuration files that require them.

## 7. Safety and scope guardrails (these are judged)

- **Synthetic data only.** No real maps, no personal data, no live feeds.
- **Simulation, not advice.** The UI says "simulation output; not an emergency-planning authority".
- **The AI critic never silently changes the city.** It outputs a `ScenarioPatch`. A human accepts it, and the sim re-runs it for verification.
- **Safety invariants** (enforced in `src/sim/invariants`, and a violation is a failed test):
  - no vehicle enters a cell above its depth limit
  - no double-allocation of a unit, bed or helicopter seat
  - no patient routed to a hospital with zero capacity, unless in declared overflow mode
  - no boat or helicopter dispatched beyond its safe-operating limit (draft, wind)
  - no hospital operated without grid power or active backup generator
  - a unit that loses its assignment is always re-queued, never silently dropped

## 8. Definition of done (for any task)

- Compiles with `strict`, lint clean, tests pass
- Works with a **mock** if upstream isn't ready
- Respects contracts and your lane
- Has at least one test or a visible demo path
- A line added to `docs/CHANGELOG.md`

## 9. Instructions for AI coding agents specifically

- Do not invent new shared types. Import from `src/contracts`.
- Do not "improve" files outside your worker brief, even if you see bugs. Log them in `docs/REQUESTS.md`.
- Prefer small, working vertical slices over large unverified rewrites.
- When unsure whether something belongs in `sim` or `render`: if it affects outcomes, it is `sim`; if it only affects pixels, it is `render`.
- Never call `Math.random` in `src/sim`. Use `ctx.rng`.
- When you finish, state what you ran to verify it.
