# AK simulation foundation

Approved in chat on 2026-10-15 after the repository analysis; based on main 181ea06.

## Scope and architecture

AK owns the pure simulation and headless execution. Shared contracts are the first
deliverable; AJ and workers can build against validated mocks independently.
Retain the Next.js agent guidance and project instructions when resolving AGENTS.md.
Use pnpm 10.28.0 (installed locally and consistent with the project documentation).
Generate a pnpm lockfile; retire the superseded Bun lockfile once installation verifies.

Implement in reviewable checkpoints: repository/tooling repair; contracts and mocks;
deterministic grid/navigation; headless weather/flood/power slice and comparison API.
The full roadmap remains binding: real agents, partial information, dispatch, hospitals,
helicopters, stress cases, replay and critic verification follow the foundation.
No comparison may claim dispatch effectiveness until both dispatch policies exist.

## Contracts

Use branded numeric IDs to match typed-array snapshots and the draft contracts;
correct the contradictory branded-string instruction. Explicit role/state enums make
snapshot integers meaningful to consumers. Define the missing InjectedEvent union,
worker input/output messages, run duration/options, and inspector selection types.
Retain existing Scenario, RenderSnapshot, MetricsFrame and RunSummary fields.
Additional report/UI metric requirements that lack data stay documented as requests.
Zod rejects invalid arrays, ranges, references, overlaps, nonfinite values, versions,
and malformed commands. Patches cannot recursively contain applyPatch commands.

## Pure simulation

Seeded RNG, typed-array world, fixed one-second ticks. Grid neighbours never wrap
across rows. Routes use A* with stable tie-breaking and multi-target flow fields.
Flood uses persistent four-direction virtual pipes, bounded outflows and explicit
source/sink accounting. Power follows graph reachability; flooded substations trip,
hospital generators consume fuel. Core state is never transferred to the renderer:
snapshots own their buffers. Browser timing and postMessage live in an adapter
outside src/sim; the same step function runs in Node.

## Health and evidence

Write behaviour tests before implementation. Verify schema fixtures, determinism,
route safety, flow conservation, blackout propagation and generator exhaustion.
Run lint, strict typecheck, Vitest, scenario validation, batch and comparison smoke
checks, production build and HTTP reachability. Record exact results, limitations
and next work in docs/AK_STATUS.md and CHANGELOG.md at each checkpoint.
Checkpoint commits are local; publication and merge are outside this execution.
