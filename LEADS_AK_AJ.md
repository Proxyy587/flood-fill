# LEADS: AK and AJ

## AK owns
`src/sim/**`, `scripts/*` (sim calls), headless runner API `runBatch(scenario, seeds, mode) -> RunSummary[]`, final say on SIM_SPEC.
Order of work: M0 contracts -> grid/nav/agents (M1) -> flood solver + conservation test (M2) -> dispatch (negotiation + centralised) + hospital balancing (M3) -> power, helicopters, injected events (M5).
Always keep `pnpm sim:compare` working. It is the proof the judges care about.

## AJ owns
`src/render/**`, `app/` integration, worker bridge, `useSceneStore`, `selectBus`, `replayBus`, camera modes (overview/focus/follow), picking, interpolation, water rendering, truth-vs-belief toggle.
Order of work: M0 fake-snapshot renderer -> chunked terrain + instanced entities (M1) -> water + rain (M2) -> route overlay + uncertainty rings (M3) -> power-off tint, helicopters (M5).

## Both
- Hour 0-2: freeze `src/contracts` from docs/CONTRACTS.md, write Zod schemas and mocks, push, then release workers.
- Every 4 hours: merge window. Run `pnpm lint test validate`. Keep `main` demoable.
- Review worker PRs against the lane rules in their briefs.
