# M3B Ambulance Dispatch and Hospital Balancing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement deterministic ambulance dispatch from uncertain report incidents through field verification, triage, safe hospital admission and adaptive staging, with negotiation/centralized comparison.

**Architecture:** Keep policy state in pure `src/sim/dispatch` modules, backed by preallocated typed arrays and stable IDs. Share feasibility, safe-route and hospital-reservation primitives; retain distinct negotiation and centralized allocation algorithms. Integrate at deterministic tick boundaries in the runner, preserve hidden truth until scene arrival, and keep existing shared contracts unchanged.

**Tech Stack:** Strict TypeScript, Vitest, Zod-validated existing contracts/scenarios, seeded RNG, pnpm scripts.

---

## File map

- Create `src/sim/dispatch/incidents.ts` and `.test.ts`: cluster delivered reports into one request, retain provenance, and manage incident/casualty lifecycle.
- Create `src/sim/dispatch/hospitals.ts` and `.test.ts`: synthetic exposure, field triage, operational-hospital eligibility, bed reservations/admissions/diversions.
- Create `src/sim/dispatch/ambulances.ts` and `.test.ts`: finite configured fleet, stable vehicle IDs, safe bases, movement and replanning.
- Create/modify `src/sim/dispatch/negotiation.ts`, `centralised.ts`, and policy tests: distinct deterministic policies over shared candidate/ETA primitives.
- Create `src/sim/dispatch/policy-common.ts`: information-limited demand/unit types, validated shared candidate enumeration, priority ordering and assignment projections.
- Create `src/sim/dispatch/hotspots.ts` and `.test.ts`: fixed 8x8 regions, rolling severe-demand scores and safe staging.
- Modify `src/sim/invariants/movement.ts` and tests only for ambulance/casualty/bed uniqueness and safe movement; preserve existing checks.
- Modify `src/sim/runner.ts` and `runner.test.ts`: construction, tick order, snapshot/metrics/events/capabilities, policy execution.
- Modify `scripts/health-living.ts` only if its smoke fixture needs rescue assertions; keep scale probes out of the core health command.
- Update `docs/SIM_SPEC.md`, `docs/ROADMAP.md`, `docs/AK_STATUS.md`, `docs/CHANGELOG.md`, and stale capability claims in `README.md`. Do not edit `src/contracts/**`, renderer/UI, other worker-owned files, or W1 assets.

## Task 1: Incident requests from report clusters

**Files:** create `src/sim/dispatch/incidents.ts`, `src/sim/dispatch/incidents.test.ts`; consume existing report arrays from `src/sim/reports/system.ts`.

- [x] **Step 1: Write behavior tests** for delivered reports at same/adjacent Manhattan cells within 30 ticks: one request with earliest report ID, all provenance retained, max confidence retained; after-window report creates a new incident; undelivered reports create none; repeated updates are idempotent.
- [x] **Step 2: Run RED**: `pnpm exec vitest run src/sim/dispatch/incidents.test.ts`; expected missing-module failure observed.
- [x] **Step 3: Implement** `IncidentSystem` with typed arrays bounded by `reports.id.length`, a report-to-incident `Int32Array` initialized to `-1`, and bounded report provenance storage. Export `createIncidentSystem(reports)`, `updateIncidents(system,reports,tick)`, and `incidentSnapshot(system)`. Dispatch-facing data is limited to request ID, estimated cell, confidence, created tick and lifecycle state; do not expose truth/source/true cell.
- [x] **Step 4: Run GREEN**: report/incident suites pass, 13 tests; strict TypeScript passes.
- [x] **Step 5: Commit**: `c97e194 feat(sim): create incidents from report clusters`.

## Task 2: Synthetic exposure, field evidence and triage

**Files:** create `src/sim/dispatch/hospitals.ts`, `src/sim/dispatch/hospitals.test.ts` (exposure and triage exports first).

- [x] **Step 1: Write tests**: health remains 100 outside `SeekHelp`/`Stranded` or at depth `<=0.3`; at depth 1.3 one tick loses 0.75; health clamps at zero; loaded patients stop exposure; triage thresholds are minor `>75`, moderate `(50,75]`, severe `<=50`; report-only dispatch receives no identity/severity.
- [x] **Step 2: Run RED**: `pnpm exec vitest run src/sim/dispatch/hospitals.test.ts`; expected missing-module failure observed.
- [x] **Step 3: Implement** pure `stepExposure(population,world,loaded)` and `triageHealth(health)`. Use existing NPC health/state and world water arrays; add no RNG and expose triage only to the scene-arrival call path.
- [x] **Step 4: Run GREEN**: hospital, incident and M3A report suites pass, 21 tests; strict TypeScript passes.
- [x] **Step 5: Commit** with `feat(sim): model deterministic field triage` (committed with this checkpoint).

## Task 3: Finite ambulance fleet and safe movement

**Files:** create `src/sim/dispatch/ambulances.ts`, `src/sim/dispatch/ambulances.test.ts`; reuse `src/sim/nav/index.ts`, `src/sim/nav/hazards.ts`, and the existing vehicle snapshot shape.

- [x] **Step 1: Write tests** for zero/configured fleet, stable ambulance IDs in the reserved emergency range (civilian cars start after it), safe placement priority (operational hospital access road, safe HQ road, lowest safe road), unavailable fleet without safe roads, depth-safe adjacent movement and deterministic replanning after closure/version change. Casualty exclusivity is tested with dispatch allocation in Task 4.
- [x] **Step 2: Run RED**: `pnpm exec vitest run src/sim/dispatch/ambulances.test.ts`; expected missing-module failure observed.
- [x] **Step 3: Implement** typed-array state sized exactly to `scenario.fleet.ambulances`; never grow it at runtime. Export creation, safe route planning, one-cell movement and owned snapshot projection. Allocate IDs from `1..scenario.fleet.ambulances` inside the emergency ID range reserved by `population.createPopulation` (civilian cars start after the combined emergency-fleet range). Because hospital building cells are not car-traversable, use a safe adjacent road access cell as the ambulance's hospital entrance base; route checks use current blocked cells, water and nav version. Never step into a newly unsafe cell.
- [x] **Step 4: Run GREEN**: ambulance and movement-invariant suites pass, 9 tests; strict TypeScript passes.
- [x] **Step 5: Commit** with `feat(sim): add finite ambulance fleet movement` (committed with this checkpoint).

## Task 4: Distinct dispatch policies and assignment lifecycle

**Files:** create/modify `src/sim/dispatch/negotiation.ts`, `centralised.ts`, and `src/sim/dispatch/policies.test.ts`.

- [x] **Step 1: Write tests** that both policies receive only pending estimated incidents and available units; ties are stable; unit/casualty allocation is unique; uncovered casualties rank before zone score, severity evidence, age and request ID; negotiation records accepted/rejected bids; centralized greedy matching returns assignments without negotiation bids.
- [x] **Step 2: Run RED**: `pnpm exec vitest run src/sim/dispatch/policies.test.ts`; expected missing shared policy module observed.
- [x] **Step 3: Implement** validated shared candidate enumeration and information-limited input types, then distinct deterministic algorithms: negotiation rounds of unit proposals with request-side ETA/ID acceptance; centralized greedy pairing by incident priority, ETA, ambulance ID and request ID. Neither policy accepts `PopulationState` or `ReportSystem`. Runner integration will translate decisions into contract events in Task 7.
- [x] **Step 4: Run GREEN**: policy suite passes, 5 tests; strict TypeScript passes.
- [x] **Step 5: Commit** with `feat(sim): add comparable ambulance dispatch policies` (committed with this checkpoint).

## Task 5: Scene search, casualty allocation and hospital beds

**Files:** extend `incidents.ts`, `hospitals.ts`, `ambulances.ts`, and their focused tests.

- [x] **Step 1: Write tests** for bounded uncertainty-footprint search only at ambulance arrival; false/unmatched reports resolve false; one cluster discovers multiple distressed civilians exactly once; persistent separate casualty records; reports resolve only after all patients admitted; atomic reservation before transport; severe chooses minimum safe ETA; lower severity can choose farther low-utilization hospital; full/flooded/unpowered hospitals are excluded; invalid reservations release/retry; no safe bed retains the patient for retry.
- [x] **Step 2: Run RED**: focused incident/hospital tests failed on the missing scene-discovery and hospital-reservation APIs.
- [x] **Step 3: Implement** `discoverIncidentAtScene` with radius `ceil((1-confidence)*4)` Manhattan cells per report estimate, reading civilian state/health only in this arrival function. Store patient links, severity and admission state in bounded typed arrays. Track occupied and in-transit beds; reserve/release/admit atomically. Severe patients choose minimum safe ETA; others minimize `ETA + 60 * (1 - severityScore) * projectedUtilization`, tie-breaking by hospital ID. Keep unadmitted patients in incident state for retry/accounting.
- [x] **Step 4: Run GREEN**: dispatch, report and movement-invariant suites pass, 43 tests; strict TypeScript passes.
- [x] **Step 5: Commit** with `feat(sim): verify incidents and balance hospital beds` (committed with this checkpoint).

## Task 6: Hot-zone scoring and idle-unit staging

**Files:** create `src/sim/dispatch/hotspots.ts`, `src/sim/dispatch/hotspots.test.ts`; integrate priority inputs with both policy algorithms.

- [x] **Step 1: Write tests** for 8x8 region mapping/map edges; score `2 * uncovered severe + severe admitted during previous 120 ticks`; expiry; stable region tie-break; staging only idle units at safe operational hospital entrances by ETA; active assignments stay intact; absent severe demand leaves units in place.
- [x] **Step 2: Run RED**: `pnpm exec vitest run src/sim/dispatch/hotspots.test.ts`; expected missing-module failure observed.
- [x] **Step 3: Implement** deterministic zone scoring and a bounded 120-tick ring buffer of severe admissions; choose the operational hospital entrance with lowest safe ETA to the highest-scoring zone. Stage only the existing fleet and respect road, power, flood, capacity and assignment constraints.
- [x] **Step 4: Run GREEN**: hotspot suite passes, 3 tests; strict TypeScript passes.
- [x] **Step 5: Commit** with `feat(sim): prioritize ambulance hot zones` (committed with this checkpoint).

## Task 7: Invariants and runner integration

**Files:** modify `src/sim/runner.ts`, `src/sim/invariants/movement.ts`, `src/sim/runner.test.ts`; extend invariant tests.

- [x] **Step 1: Write runner tests** for correct RUN_STARTED capabilities/stage, delivery→dispatch→scene evidence, movement and bed transitions, owned ambulance snapshots, deterministic replay, identical world/report truth across modes, utilization, TTS/unmet and falsification.
- [x] **Step 2: Run RED**: runner behavior was introduced after the feature suites; integration exposed an unsafe fixture where flood correctly disabled the only hospital, then a safe-flood fixture passed end-to-end.
- [x] **Step 3: Implement** incident, hospital and dispatch construction in runner. Hazards/power/closures and agents precede exposure/reports, dispatch, movement, scene evidence, bed reservation/transport/admission and hotspot staging. `RUN_STARTED` and capabilities reflect M3B; events explain assignment, verification, diversion and service. TTS is report-to-scene; unmet counts active incidents/confirmed unadmitted patients once; district delay Gini uses current-tick censoring. Frozen `RunSummary.hotspots` supports no ambulance-hot-zone kind; staging is visible via assignment/reroute events and the existing array remains empty.
- [x] **Step 4: Run GREEN**: `pnpm exec vitest run src/sim/runner.test.ts src/sim/invariants/movement.test.ts src/sim/dispatch` (54 tests pass).
- [x] **Step 5: Run integration gate**: `pnpm health` passes lint, strict types, 407 tests and schema-only validation (`releaseReady:false`). No shared contract change was required.
- [x] **Step 6: Commit** with `feat(sim): integrate ambulance response pipeline`.

## Task 8: Scale, comparison and stage documentation

**Files:** modify `scripts/health-living.ts` only if needed; update `docs/SIM_SPEC.md`, `docs/ROADMAP.md`, `docs/AK_STATUS.md`, `docs/CHANGELOG.md`, and stale capability claims in `README.md`.

- [x] **Step 1: Add deterministic integration/scale assertions** for 10,000 civilians, bounded report storage, configured seven-ambulance count, false-report closure, hospital diversion/admission and both policies on identical scenario/seed. Existing tests assert same-policy replay and matching world/report truth across modes; no universal policy superiority is assumed.
- [x] **Step 2: Run gates**: `pnpm health` (407 tests), `pnpm build`, `pnpm sim:batch --ticks 120 --seeds '0,42,77'`, `pnpm sim:compare --ticks 120 --seeds '0,42,77'`, `pnpm exec tsx scripts/health-living.ts`, and `git diff --check`; all pass. Both modes are in comparison output; validation explicitly remains schema-only with `releaseReady:false`.
- [x] **Step 3: Record limitations**: ambulance-only implemented; boats/police/helicopters, UI integration, W1 templates and release review remain pending. Exact results/limitations recorded in AK_STATUS and CHANGELOG.
- [x] **Step 4: Review paths**: no contract, AJ/Worker 1 or unrelated edits.
- [x] **Step 5: Commit** with `docs(sim): checkpoint M3B ambulance dispatch`.

## Acceptance and stop conditions

- A delivered cluster creates one provisional request with complete report provenance; dispatch cannot inspect hidden truth before field arrival.
- Field verification can falsify reports; multiple casualties are allocated once and remain visible if finite units/beds are insufficient.
- Only configured ambulances exist; scene triage precedes hospital choice; reservations are atomic and destinations remain powered, reachable and safe.
- Both modes are distinct, deterministic and comparable on identical inputs; no unsupported superiority claim.
- Severe demand raises zone priority and stages only idle existing units; active assignments are not abandoned.
- Completion, diversion, unmet demand and assignments have auditable event reasons; metrics do not double-count.
- Any required shared-contract change pauses implementation for explicit AK/AJ approval. Merge, push, PR, release claim and W1/AJ-owned edits are out of scope.
