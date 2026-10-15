# M3A Uncertain Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, uncertainty-tagged civilian reports and a confidence-weighted HQ belief layer without adding rescue requests or dispatch.

**Architecture:** A pure `src/sim/reports` subsystem owns bounded typed-array report and belief state, including hidden truth labels used only by tests. A dedicated RNG stream derived from the run seed produces report uncertainty without perturbing population or traffic. The runner feeds distress transitions, scheduled false-report/comms-outage injections, and snapshots/events through the subsystem using the already-frozen contracts.

**Tech Stack:** TypeScript strict, typed arrays, existing Mulberry32 RNG, Zod contract schemas, Vitest, pnpm health/build/headless scripts.

---

## File map

- Create `src/sim/reports/system.ts`: internal report table, HQ belief, deterministic generation/delivery/clustering and owned render projection.
- Create `src/sim/reports/system.test.ts`: focused deterministic report semantics tests.
- Modify `src/sim/runner.ts`: initialize the report subsystem, process tick-boundary injections/outages, step reports after agent state changes, expose report snapshots/events.
- Modify `src/sim/runner.test.ts` or add `src/sim/reports/runner.test.ts`: end-to-end injection, outage, schema and repeated-run tests.
- Modify `scripts/health-living.ts`: add three-seed report determinism/uncertainty smoke, keeping existing evacuation smoke.
- Modify `docs/SIM_SPEC.md`, `docs/ROADMAP.md`, `docs/AK_STATUS.md`, `docs/CHANGELOG.md`, and `docs/REQUESTS.md`: record implemented report semantics, actual verification and AJ/W3 consumption; preserve remaining M3 scope.

## Task 1: report state and deterministic distress-report generation

**Files:** create `src/sim/reports/system.ts`, create `src/sim/reports/system.test.ts`.

- [x] **Step 1: Write the failing generation tests.** Cover one civilian entering `SeekHelp`, repeated ticks producing one report, awareness 0 suppressing calls, awareness 1 giving zero location error, and stable report IDs/order.
- [x] **Step 2: Verify RED.** `pnpm exec vitest run src/sim/reports/system.test.ts` first fails because the module is absent; after a minimal API scaffold, tests exercise behavior and expose a width/height defect.
- [x] **Step 3: Implement the minimal pure subsystem.** Store report fields in bounded typed arrays; track active distress episode per NPC; derive a separate report RNG from `seed ^ 0x9e3779b9`; use `awareness` as the call Bernoulli probability, `ceil((1-awareness)*4)` as maximum Manhattan position-error radius, and awareness as confidence. Clamp estimates to map bounds. Do not import runner, React, Next, renderer, window, or document.
- [x] **Step 4: Verify GREEN and determinism.** `pnpm exec vitest run src/sim/reports/system.test.ts`: 4/4 pass; repeated same-seed arrays/events match.

## Task 2: scheduled false alarms, delivery delay, outages, and HQ belief

**Files:** modify `src/sim/reports/system.ts`, `src/sim/reports/system.test.ts`.

- [x] **Step 1: Write failing tests.** Covered false alarm 0/1 bounds, delayed delivery, outage buffering, confidence-weighted belief, distinct adjacent reports, and independent RNG streams.
- [x] **Step 2: Verify RED.** Focused run exposed missing false alarms, snapshot/delivery API and injection/clustering behavior; after implementation, fixture isolation caught and corrected an unintended distress report in the clustering test.
- [x] **Step 3: Implement those behaviors.** At most one anonymous false alarm per civilian/run uses its own RNG. Hidden `isFalse` and true position/source data remain internal. All published reports are `Unverified`. Capacity is `2*civilianCount + scheduled false injection count`; delivery respects `commsDelay` and outages; nearby same/adjacent cells within 30 ticks contribute only maximum confidence at the earliest anchor.
- [x] **Step 4: Verify GREEN.** Focused subsystem/runner suite passes 19/19, including no hidden labels in event payloads or report snapshots, tick-zero delivery, and strict typecheck.

## Task 3: integrate report lifecycle with the runner and frozen contracts

**Files:** modify `src/sim/runner.ts`; create or modify `src/sim/reports/runner.test.ts`.

- [x] **Step 1: Write failing runner tests.** Extended runner coverage for injected reports, delay/outage recovery, owned report buffers, and schema-valid snapshots.
- [x] **Step 2: Verify RED.** Existing unsupported-injection assertion failed after intentionally enabling M3A actions; replaced it with delivery/recovery integration assertions.
- [x] **Step 3: Integrate at simulation boundaries.** Runner applies injections at named boundaries, steps agents before report creation/delivery, uses half-open outage intervals and exports copied `{x,z,confidence,status}` arrays. Events disclose no hidden truth.
- [x] **Step 4: Verify GREEN.** Focused subsystem/runner tests pass 18/18 and strict TypeScript passes; broader agent/evacuation and full health checks remain scheduled for Task 4.

## Task 4: multi-seed, scale, and purity verification

**Files:** modify `scripts/health-living.ts`, add report-scale coverage under `src/sim/reports/system.test.ts` if needed.

- [x] **Step 1: Add deterministic smoke assertions.** Seeds `[0,42,77]` repeat byte-identically; unit tests cover false-alarm 0/1 bounds and valid snapshots/events.
- [x] **Step 2: Exercise the bound.** Each 10,000-civilian smoke run creates 10,000 stochastic false alarms and 5,000 scheduled `false_report` injections; exactly 15,000 reports deliver within the `2*civilians + scheduled` cap, and same-seed run output is identical.
- [x] **Step 3: Run `pnpm exec tsx scripts/health-living.ts`.** Existing population and shelter checks pass; three-seed report determinism/capacity result passes.
- [x] **Step 4: Run `pnpm health`, `pnpm build`, `pnpm sim:batch`, and `pnpm sim:compare`.** All pass. Health: lint, strict typecheck, 366 tests, schema-only validation (`releaseReady:false`). Batch/compare run; rescue-policy comparison remains unavailable until M3B. `git diff --check` passes.

## Task 5: update docs and checkpoint the verified slice

**Files:** modify `docs/SIM_SPEC.md`, `docs/ROADMAP.md`, `docs/AK_STATUS.md`, `docs/CHANGELOG.md`, `docs/REQUESTS.md`.

- [x] **Step 1: Update claims from observed behavior only.** SIM_SPEC, ROADMAP, REQUESTS and AK_STATUS document implemented M3A semantics; M3B dispatch/aircraft, full stress scenario, browser rendering and W1 templates remain pending.
- [x] **Step 2: Record exact test/health/build/smoke outputs.** Docs state 366 tests, build and batch/compare pass, 15,000 deliveries across 10k civilians per seed, schema-only `releaseReady:false`, and aggregate review limitations.
- [x] **Step 3: Verify docs and tree.** `git diff --check`, health, build and focused/system smoke passed after source changes; documentation-only changes are now staged for the final verification pass.
- [ ] **Step 4: Commit locally.** Commit implementation and tests first, then a docs/evidence checkpoint. Do not push, merge, open a PR, or claim release readiness.

## Plan self-review

- Every design acceptance item maps to Tasks 1–5: determinism and separate RNG (1/4), distress and uncertainty (1), false alarms and injected false reports (2/3), delays/outages (2/3), clustering/HQ belief (2), frozen snapshot/event validation (3), derived record bound (2/4), and health/build/docs (4/5).
- Verification deliberately leaves `Verified`, `Resolved`, and `False` status transitions to M3B because field evidence and response units are outside this slice.
- No public contracts, dispatch resources, helicopters, real-world feeds, renderer behavior, or response metrics are added here.
