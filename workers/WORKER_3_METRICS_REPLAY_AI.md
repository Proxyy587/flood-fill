# WORKER 3 — Metrics Dashboard, Replay and AI Critic

Read `AGENTS.md`, `docs/CONTRACTS.md` (esp. `SimEvent`, `MetricsFrame`, `RunSummary`, `ScenarioPatch`), `docs/SIM_SPEC.md` §6, §10 and all of `docs/AI_CRITIC.md` first.

## Your lane
**You may edit only:**
- `src/ui/dashboard/**`, `src/ui/replay/**`, `src/ui/critic/**`
- `src/ai/**`
- `app/api/critic/**`
- `scripts/compare.ts`, `scripts/batch.ts` (**only** the reporting and aggregation parts; AK owns the sim calls inside them)
- `docs/REQUESTS.md` (append only)
- `docs/CHANGELOG.md` (append only)

Do **not** touch `src/sim`, `src/render`, `src/editor`, `src/contracts` (read only).

## Mission
Turn a run into **evidence**: charts, a replayable timeline with reasons, and an AI critic whose claims are verified by re-simulation.

## Work from mocks
Use `src/contracts/mocks` (`mockRunSummary`, `mockEvents`). Also write your own bigger fixtures in `src/ai/fixtures/` (a plausible run with hospital overload, a gridlock, a power trip). The real data arrives around hour 18.

## Task A: Dashboard (hours 0–8)
`src/ui/dashboard/`:
- Time-series: flooded area, evacuation %, stranded, gridlock cells, % unpowered, per-hospital utilisation (multi-line with a diversion marker), generator fuel depletion countdown, helicopter sorties and rooftop rescues.
- Response metrics: time-to-service mean/p50/p90 per request class, unmet requests, idle fraction per unit type (ground vs boat vs air), route violations (must read 0, so highlight red if not).
- **Fairness view:** bars per district (time-to-service) plus the Gini value.
- **Compare view:** two `RunSummary`s (negotiation vs centralised, or before/after patch) side by side with deltas, with spread bars when given N seeds. Colour improvement vs worse, and say "no clear effect" when the spread overlaps zero.
- Export a one-page **run report** (HTML print stylesheet or Markdown download).

## Task B: Replay and "why" panel (hours 8–16)
`src/ui/replay/`:
- A timeline scrubber with event markers coloured by type (flood, closure, dispatch, hospital, power trip/blackout, helicopter rescue/grounding, injected, invariant). Zoom and filter by type or actor.
- Clicking an event emits `replayBus.seek(tick)` and `selectBus.focus(actor)` (AJ listens). Event detail card shows `reason`, `data` and related events (same request id).
- **Why was this rerouted?** For a selected unit, show a chain: assignment → bids → cancel reason → reroute cause → new assignment, built from the log by `buildDecisionChain(events, actorId)` (unit-tested).
- Assignment log table (sortable, searchable) and a "request lifecycle" view (created → bids → assigned → served).
- After-action summary generated from deterministic templates (no LLM): the top 5 incidents of the run (including major substation trips and critical rooftop airlifts).

## Task C: Analysers and evidence pack (hours 12–18)
`src/ai/analysers/`: pure TypeScript functions over `RunSummary`:
`gridlockHotspots`, `isolatedZones`, `isolatedRooftops`, `hospitalImbalance`, `powerCascade`, `drainageCoverage`, `responseGaps`. Each returns `{ findings, cells, score, evidenceTicks }`. Unit-test each on a fixture.
`src/ai/evidence.ts`: builds the compact evidence pack (≤ ~6k tokens, so write a rough token estimator and a test), using landmark and district names rather than raw grids, plus an optional ASCII mini-map.

## Task D: Critic route and report UI (hours 18–26)
- `app/api/critic/route.ts`: POST an evidence pack, call the Anthropic API using `process.env.ANTHROPIC_API_KEY`, validate the response against the `CriticReport` Zod schema, retry once with the validation error, rate-limit, and **never log the key**. Return a 200 with `source: 'llm' | 'fallback'`.
- **Fallback:** if there's no key, a network failure or invalid JSON twice, build a `CriticReport` from the analysers alone (templated sentences). The demo must work offline.
- `src/ai/patchCompiler.ts`: converts proposals to `ScenarioPatch`. Whitelist command kinds (drainage, roads, levees, backup generators, substation relocation, helipads), clamp to the grid, cap cost to the budget, reject anything else (test with hostile input).
  Initial executable whitelist: road/bridge/drainage/levee block changes and helipad
  BuildingDef placement only. Generator/substation relocation proposals are blocked
  until matching contract commands are approved (see REQUESTS.md). Wider buildings
  and policy changes in AI_CRITIC.md are deferred extensions, not initial permissions.
- `src/ui/critic/`: report panel with findings (severity, confidence, evidence links that jump the replay and highlight cells via `selectBus`), proposals with **Preview / Apply / Verify** buttons, a before/after chart, and the "AI hypothesis, verified by simulation" label.
- **Verify** calls `verifyPatch(scenario, patch, seeds)`, which uses AK's headless runner API (`runBatch`) and returns the metrics delta. Until it exists, mock it with fixture numbers marked "MOCK".

## Task E: Offline pack and honesty (hours 26–30)
- Pre-generate and commit a critic report and a verification result for each template under `src/ai/cache/`, used when offline.
- A **Limitations** component shown with every report: synthetic data, simplified physics, not an emergency-planning authority, LLM output is a hypothesis.
- Make sure "worse" or "no clear effect" results are displayed prominently.

## Tests
- Analysers on fixtures; `buildDecisionChain`; evidence token budget; patch compiler rejection cases; the Zod schema retry path with a mocked fetch; fallback path with no key.

## Done means
- [ ] Dashboard renders from `mockRunSummary` and from your big fixture
- [ ] Compare view shows deltas with spread and the "no clear effect" state
- [ ] Replay scrubber focuses entities through the bus; decision chain tested
- [ ] `/api/critic` works with a key, and without a key returns a fallback report
- [ ] Patch compiler cannot emit non-whitelisted or out-of-bounds commands
- [ ] Offline cached reports exist for all templates
- [ ] CHANGELOG lines added

## If blocked
`docs/REQUESTS.md`: `[W3 → AK] need runBatch(scenario, seeds, mode) → RunSummary[]`. Keep going with fixtures.
