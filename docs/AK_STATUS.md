# AK execution checkpoints

## M1/M2 checkpoints; active M3A reports slice (2026-10-15)

Local source checkpoint: **b5ad965** on codex/ak-foundation. Source, tests and stage
docs committed together. It is a progress checkpoint, not aggregate review approval.
Next AK slice builds on M2 evacuation; uncertain reports belong to M3. M1 and M2
verification records appear below. Browser/template integration and independent
review gates remain open.

Bridge metadata/custom schedules/run parameters are schema-checked. Seeded population,
hazard mode grids and traffic primitives are implemented. Continuous walk-drive-walk
commuting, failed-car obstruction, dynamic retry/reroute, medical workplace reassignment
and copied snapshot/inspector outputs now run through the headless API. Both policy
labels still use the same non-dispatch core; comparative policy effectiveness is unavailable.

Stage B/C evidence: missing-module RED observed before movement implementation;
329-test health passed before runner integration. Runner integration tests then
reproduced empty tables/unsupported closures and passed after wiring. Interrupted-edge
state and daily-departure regressions reproduced two failures and now pass. Focused
agent/invariant suite initially passed 22 tests. A first five-area review reproduced
ghost driving after car failure, unavailable medical workplaces, stationary Moving
cars, unbounded search/cache work and stale docs. Regression tests went RED, then
passed after fixes. Search/cache/route retention now have deterministic budgets.

Final pre-checkpoint health: 348 tests, lint/types/schema pass; production build
passes after the retained-route bound. Independent Luna-medium delta assertions
confirm exact route counters on completion and failed-car truncation; the long-snake
case retains 247,650 entries and defers 25 requests within the 262,144-entry cap.
Multi-seed 600-tick CLI batch/compare pass on seeds 0/42/77:
61 metric frames/run, 12 NPC creation events/run and 10 arrivals/run. Comparison is
explicitly unavailable for rescue policies. Synthetic load/movement probes pass
12/1000/10000 civilians, including no teleport checks; the 10000-civilian/30-tick
probe takes about 1.9 seconds with queue budgeting, not an 8ms/tick guarantee.

Initial primitive reviewer hit usage limits; subsequent review ran. Luna-medium
QA/quality/security substantive rechecks pass, but goal/context could not complete
CodeRabbit prerequisites and the security-review skill is absent. Aggregate review
is INCONCLUSIVE, not approved. See AK_REVIEW.md. No merge/push/PR or release claim.

### M2 stage A: warnings and shelter evacuation (implemented; broader roadmap active)

TDD observed missing behavior for delayed warnings, shelter reservations, tick-zero
overflow and warnings during a partial commute edge. Implemented global HQ warning
delay plus local exposure utility, per-civilian reservations, continuous rerouting,
stranded retries, boundary overflow and measured evacuation completion. Regressions
cover mid-edge diversion, overflow while traveling, occupied-shelter flooding, and
capacity reopening after water recedes. Full health passes 356 tests, lint, strict
types and schema-only validation; production build passes. The three-seed [0,42,77]
one-seat contention smoke deterministically produces one evacuation order and one
stranded civilian per run. Synthetic population probes pass 12/1000/10000 residents;
the 10000-resident/30-tick run takes about 2.7s. This is not full rescue stress or
proof of the 8ms target. Dispatch comparison and worker/template release gates remain
unavailable.

### M3A: reports implemented; M3B dispatch design under review

Detailed reports-first design and inline plan are committed in 1f9c471. The managed
worktree `codex/ak-m3-reports` excludes active untracked W1 assets. Frozen-lockfile
install succeeds. Clean baseline `pnpm health` passes lint, strict types, 356 tests,
and schema-only validation (`releaseReady:false`). The first four report tests were
written before the subsystem; missing-module RED was observed, then the behavioral
suite passes 4/4 after implementing deterministic distress reporting, awareness
gating/confidence, bounded position error, and a dedicated report RNG stream.
The M3A reports slice adds bounded typed-array report state, independent
distress/false-alarm RNG streams, per-civilian false alarms, delayed delivery,
outage buffering, maximum-confidence clustering and owned snapshots. Runner support
for existing false_report/comms_outage injections is in place. Focused subsystem and
runner tests pass 19/19. Final health passes lint, strict types, 366 tests and
schema-only validation (`releaseReady:false`); production build, batch/compare and
the living-city script pass. Its three-seed report smoke confirms 15,000 deterministic
deliveries/run at 10,000 civilians without exceeding capacity. No contract, renderer,
or W1 files have been changed. M3B rescue requests/dispatch, aircraft, full stress
scenario and UI integration remain pending.

M3B design and implementation plan are approved and committed:
`docs/superpowers/specs/2026-10-15-ak-m3b-ambulance-dispatch-hospital-design.md` and
`docs/superpowers/plans/2026-10-15-ak-m3b-ambulance-dispatch.md`. Scope is ambulance-
first dispatch with hospital balancing and adaptive hot-zone response, one
provisional request per report cluster, field-only triage, multiple casualties per
incident and a finite fleet. Inline implementation is in progress. Task 1 adds
bounded incident requests/provenance over delivered M3A clusters (including late
cluster-bridge coalescing); Task 2 adds deterministic synthetic flood exposure and
field triage; Task 3 adds a finite typed-array ambulance fleet, safe road access
bases, hazard-aware routes and deterministic replanning; Task 4 adds distinct
negotiation and centralized dispatch over a shared candidate set without access to
hidden truth. RED was observed before each module; current focused
incident/report/hospital/ambulance/policy/movement suites pass 35 tests and strict
TypeScript passes. Hospital building cells are represented by their nearest safe
adjacent road cell for ambulance staging. No shared-contract changes.

## 2026-10-15 baseline

- Pulled main d5a990b → 181ea06 by fast-forward; clean checkout before work.
- Work branch: codex/ak-foundation. Approved design and plan in docs/superpowers/.
- Existing problems: committed AGENTS merge markers; pnpm/Bun mismatch; dependencies
  absent; missing contracts, sim, tests, schemas and runner commands.
- Baseline lint fails because eslint is not installed; there is no baseline test script.

## Checkpoint 0: repository/tooling (d077579)

Checkpoint 0 verified: pnpm install completed; Vitest runs without configuration
warning after enabling ESM, Node type peer aligned to runtime. Strict checking needs
`next typegen` before `tsc` (fresh checkout LayoutProps was otherwise undefined);
the installed Next.js CLI and TypeScript guides specify this exact sequence.
Lint and typecheck both pass; 63 contract/RNG/grid/navigation tests pass at this point.
The superseded Bun lockfile was removed; pnpm-lock.yaml is the reproducible lockfile.

The following sections record subsequent stages. The full living-city and dispatch
roadmap remains pending; see ROADMAP.md.

## Checkpoint 1: contracts and mocks

- Frozen types, Zod schemas, worker protocol, inspector selections and explicitly
  MOCK-labelled consumer fixtures. CONTRACTS.md records approved decisions.
- Initial missing-module red, then 12 schema tests pass. Independent spec review
  caught snapshot ID/enum and placement/inspector gaps; regression tests reproduced
  3 failures, fixes bring contract tests to 15/15. Strict checking passes.
- Spec re-review passes, including 297 boat-ID boundary probes and 90 independent
  snapshot buffers. Quality review found reverse building tiles/Float32 headroom/
  path precision defects; regression tests reproduce them and fixes pass.
- Domain decisions: buildings match tiles both directions; floor <=255m; source
  rates <=1000m/tick; nav costs are bounded 1/1024 fixed point on <=128x128 grids.
- No renderer/editor/dashboard/AI code changed.

## Checkpoints 2/3: deterministic core and headless slice

- RNG/world, heap A*, reverse Dijkstra flow fields, pure import/determinism lint guards.
- Weather, bounded virtual pipes, drainage, power graph trips, generator fuel and
  hospital diversion; createSimulation and runBatch; validated headless CLIs.
- Tests were written before implementation and observed missing-module red; reviewer
  reproductions added failing cases for sill overshoot, source overflow, fault tick
  mismatch and repeated diversion. Later generator and numeric boundary regressions
  bring health to 197 tests; final extension/seed/resource/schema-only regressions
  bring the current suite to 209 passing tests. Lint and strict types pass.
- Production build passed; HTTP GET http://127.0.0.1:3100 returned 200 (starter page).
- Batch/compare ran seeds 0,42,77 for 600 ticks, 61 metric frames/run. Foundation
  outputs explicitly disclaim dispatch evidence; final smoke rerun after review
  fixes succeeds and measures max depth 0.82195m.
- 96x96 foundation-only benchmark: 500 measured ticks after 100 warmup ticks;
  mean 0.824ms, p95 1.017ms, max 1.334ms. No agents/vehicles in this measurement;
  it is not proof of the full performance budget.
- Normal validation passes the MOCK fixture with 0 templates and releaseReady:false;
  pnpm validate --require-templates correctly fails (W1 dependency).
- pnpm install --frozen-lockfile succeeds. Production audit: no known vulnerabilities.
  Full audit: one high development-tool advisory in braces via Next ESLint/fast-glob/
  micromatch, GHSA-vfj7-8cjw-p6xm; registry lists no patched version. Unresolved;
  no runtime exposure path found in this foundation. ESLint9 also reports deprecation;
  retain compatible scaffold plugins until a separately verified tooling update.

## Source checkpoint 7c19583 and final gates

All implementation files are included in source commit 7c19583. Logical
stages 1-3 are consolidated atomically so public CLI entrypoints and dependencies
land together. Fresh `pnpm health`: 209/209 tests, lint, strict typecheck and schema
validation pass. Fresh `pnpm build` succeeds after the final code fixes. Final
batch/compare smoke on the committed source succeeds (3 seeds, 600 ticks), and
HTTP returns 200. Integration re-review passes 111 focused checks. Full five-area
review results and the inherited development-tool advisory are in AK_REVIEW.md.
The final docs checkpoint records this evidence; source remains unchanged since
the 209-test health/build pass. No merge, push or PR was requested or performed.

At the foundation checkpoint, M1 agents/traffic were pending. Current progress is
recorded above. M3 uncertain reports/dispatch/hospital allocation/aircraft and
remaining invariants; M4 patch verification; and M5 full stress integration remain.
AJ's worker/render and W1 templates remain separate ownership dependencies.
Goal remains active.

## M1 planning baseline (historical)

Revalidated clean f058ff3 and full baseline health (209 passing tests). Design/plan:
docs/superpowers/{specs/2026-10-15-ak-living-city-design,plans/2026-10-15-ak-living-city}.md.
Stage A began with bridge decks, schedules, run parameters and typed live-event
actors. Current implementation/evidence is recorded in the active M1 section above.
