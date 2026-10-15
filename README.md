# FloodSim

Synthetic 2.5D city/flood sandbox for Code-E-Manipal 2.0, PS27. The target is a
living city with uncertain reports, constrained rescue dispatch, replay and an AI
critic whose proposals are verified by simulation. Simulation output is not an
emergency-planning authority.

## Current state

AK foundation: frozen contracts/mocks, seeded RNG, grid loading, weighted A*/flow
fields, weather, virtual-pipe flood, power cascade/generators, pure headless runner.
The browser still displays the Next.js starter page. Agents, dispatch, aircraft,
editor, renderer, replay and critic integration are pending. See docs/AK_STATUS.md.

## Setup and verification

Node 24+ and pnpm 10.28.0. Run `pnpm install --frozen-lockfile`.
The repository uses ESM and pnpm-lock.yaml; the former Bun lockfile is retired.

```powershell
pnpm dev
pnpm health  # lint, Next route typegen + strict tsc, tests, fixture/template validation
pnpm build
pnpm validate --require-templates  # schema/presence gate: fails until templates exist
```

## Headless API and smoke commands

```ts
import { runBatch, createSimulation } from "./src/sim";
import { mockScenario } from "./src/contracts/mocks";

const runs = runBatch(mockScenario(), [0, 42, 77], "negotiation", { durationTicks: 600 });
const simulation = createSimulation(mockScenario(), 42, "centralised");
simulation.step(); // one simulated second; no wall-clock dependency
const snapshot = simulation.snapshot(); // owns all buffers, safe to transfer
```

```powershell
pnpm sim:batch --ticks 600 --seeds '0,42,77' --out out/batch.json
pnpm sim:compare --ticks 600 --seeds '0,42,77' --out out/compare.json
pnpm sim:batch --scenario scenarios/riverside-town.json --ticks 1200 --out out/town.json
```

Quote comma-separated seeds in PowerShell. Without --scenario, commands use
MOCK foundation town; output includes implemented capabilities. Comparison runs
both mode labels but explicitly declares dispatch unavailable. Agent-dependent
metrics are zero placeholders and idle fractions are empty; only weather, water
and power are currently measured. unpoweredPopPct estimates homes by capacity.

No Worker 1 templates exist yet. `pnpm validate` checks the contract fixture and
all scenario files present, prints their count and reports templatesPresent.
releaseReady remains false: schema validity alone cannot establish template
connectivity/quality or full milestone completion. --require-templates fails if
no scenario files exist. scenarios/index.json is a manifest and excluded from
individual Scenario validation; W1 must validate its format and references.

## Ownership

Read AGENTS.md and workers/LEADS_AK_AJ.md. AK owns src/sim/headless sim calls;
AJ owns rendering and the browser worker bridge. Other briefs define worker lanes.
Import shared types from src/contracts. Record contract decisions in CHANGELOG.md
and cross-lane requests in docs/REQUESTS.md.
