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

- [ ] **Step 1: Write the failing generation tests.** Cover one civilian entering `SeekHelp`, repeated ticks producing one report, awareness 0 suppressing calls, awareness 1 giving zero location error, and stable report IDs/order.
- [ ] **Step 2: Verify RED.** Run `pnpm exec vitest run src/sim/reports/system.test.ts`; expected failure because the report module is absent.
- [ ] **Step 3: Implement the minimal pure subsystem.** Store report fields in bounded typed arrays; track active distress episode per NPC; derive a separate report RNG from `seed ^ 0x9e3779b9`; use `awareness` as the call Bernoulli probability, `ceil((1-awareness)*4)` as maximum Manhattan position-error radius, and awareness as confidence. Clamp estimates to map bounds. Do not import runner, React, Next, renderer, window, or document.
- [ ] **Step 4: Verify GREEN and determinism.** Rerun the focused file, then run the same report test with two identical seeds and compare every typed array and emitted event.

## Task 2: scheduled false alarms, delivery delay, outages, and HQ belief

**Files:** modify `src/sim/reports/system.ts`, `src/sim/reports/system.test.ts`.

- [ ] **Step 1: Write failing tests.** Cover `falseReportRate=0` and `=1` per run, report delivery not before `commsDelay`, outage buffering until recovery, confidence-weighted belief, and same-cell reports within 30 ticks retaining separate provenance while contributing only the cluster maximum confidence.
- [ ] **Step 2: Verify RED.** Run `pnpm exec vitest run src/sim/reports/system.test.ts`; expected failures are missing false alarms, buffered delivery and belief clustering.
- [ ] **Step 3: Implement those behaviors.** Draw at most one anonymous false alarm per civilian per run according to `falseReportRate`; use only the report RNG. Store its hidden `isFalse` bit outside all HQ-visible data. A false alarm and a normal report both appear as Unverified to HQ. Allocate at most `2*population.count + scheduledFalseReportCount` report slots: one distress report and one false alarm per civilian plus each injected false report. Use `commsDelay` for delivery and hold pending reports during the injected outage. Belief clusters are stable by first report ID, use same/adjacent estimated cells within 30 ticks, and contribute only the maximum member confidence at the cluster anchor.
- [ ] **Step 4: Verify GREEN.** Rerun focused tests; assert injected false truth labels do not appear in snapshot arrays, HQ belief, or report event data.

## Task 3: integrate report lifecycle with the runner and frozen contracts

**Files:** modify `src/sim/runner.ts`; create or modify `src/sim/reports/runner.test.ts`.

- [ ] **Step 1: Write failing runner tests.** Assert that a seeded stranded civilian creates a delayed unverified report, `false_report` injection creates only a synthetic sighting, `comms_outage` delays delivery without loss, returned report buffers are owned copies, and both snapshots and summaries pass existing Zod schemas.
- [ ] **Step 2: Verify RED.** Run `pnpm exec vitest run src/sim/reports/runner.test.ts`; expected failures show empty report snapshots and no report lifecycle events.
- [ ] **Step 3: Integrate at simulation boundaries.** Preserve current boundary ordering: apply scheduled events and weather/flood/power/closures, step agents, then step report generation and delivery. Make outage intervals half-open `[tick,tick+durationTicks)`. Create injected sightings with `ReportStatus.Unverified`; never pass their hidden label to HQ decisions. Export copied `{x,z,confidence,status}` typed arrays in each snapshot and reasoned `REPORT_CREATED` events with the estimated cell/confidence/report ID.
- [ ] **Step 4: Verify GREEN.** Run focused runner/report tests and `pnpm exec vitest run src/sim/runner.test.ts src/sim/agents/runner-living.test.ts src/sim/agents/evacuation.test.ts`.

## Task 4: multi-seed, scale, and purity verification

**Files:** modify `scripts/health-living.ts`, add report-scale coverage under `src/sim/reports/system.test.ts` if needed.

- [ ] **Step 1: Add deterministic smoke assertions.** Three seeds `[0,42,77]` each repeat byte-identically; assert false-alarm rate zero/one boundaries and no invalid cells/confidences/statuses.
- [ ] **Step 2: Exercise the bound.** Use a 10,000-civilian synthetic run with `falseReportRate=1`, one distress report per civilian, and a scheduled `false_report` injection for every second civilian; assert created reports never exceed the precomputed capacity and repeat the run to confirm identical records/events.
- [ ] **Step 3: Run `pnpm exec tsx scripts/health-living.ts`.** Expected output retains the M2 population and shelter checks and adds a report determinism/capacity result.
- [ ] **Step 4: Run `pnpm health`, `pnpm build`, `pnpm sim:batch`, and `pnpm sim:compare`.** Health must pass; build must succeed; batch/compare must run while clearly labeling rescue-policy comparison unavailable until M3B. Also run `git diff --check`.

## Task 5: update docs and checkpoint the verified slice

**Files:** modify `docs/SIM_SPEC.md`, `docs/ROADMAP.md`, `docs/AK_STATUS.md`, `docs/CHANGELOG.md`, `docs/REQUESTS.md`.

- [ ] **Step 1: Update claims from observed behavior only.** Document distress trigger, awareness/error/confidence semantics, false alarm per-person/per-run semantics, delay/outage behavior, confidence cluster rule, derived cap, hidden truth boundary, and unchanged unavailable metrics. Mark M3A reports implemented but M3B requests/dispatch, helicopters, full stress scenario, AJ rendering, and W1 templates pending.
- [ ] **Step 2: Record exact test/health/build/smoke outputs.** Include the suite count and explicitly retain schema-only `releaseReady:false` and aggregate review limitations.
- [ ] **Step 3: Verify docs and tree.** Run `git diff --check`, `pnpm health`, `pnpm build`, and the focused report smoke once more after documentation changes.
- [ ] **Step 4: Commit locally.** Commit implementation and tests first, then a docs/evidence checkpoint. Do not push, merge, open a PR, or claim release readiness.

## Plan self-review

- Every design acceptance item maps to Tasks 1–5: determinism and separate RNG (1/4), distress and uncertainty (1), false alarms and injected false reports (2/3), delays/outages (2/3), clustering/HQ belief (2), frozen snapshot/event validation (3), derived record bound (2/4), and health/build/docs (4/5).
- Verification deliberately leaves `Verified`, `Resolved`, and `False` status transitions to M3B because field evidence and response units are outside this slice.
- No public contracts, dispatch resources, helicopters, real-world feeds, renderer behavior, or response metrics are added here.
