# AK Mainline Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the main-based FloodSim demo reliably playable while showing real AK dispatch, hospital, boat, and police decisions through AJ's worker and renderer.

**Architecture:** Keep `SimHost` as the only worker runtime and `src/worker/akAdapter.ts` as the only active AK/UI translation boundary. Bound synchronous playback work so worker commands can be handled between slices, contain asynchronous worker faults, and ensure every exposed core action is either implemented or explicitly disabled.

**Tech Stack:** Next.js 16, strict TypeScript, Vitest, Web Worker protocol, Zustand, three.js renderer.

---

## File map

- `src/worker/host.ts`: playback scheduling, catch-up slices, and worker fault containment.
- `src/worker/host.test.ts`: deterministic protocol tests for pause responsiveness, seek/replay, and asynchronous faults.
- `src/worker/akAdapter.ts`: UI event compatibility with AK capabilities.
- `src/worker/engines.test.ts`: core adapter acceptance/refusal regression cases.
- `src/shell/Transport.tsx`: accurately represent core-only limitations in the rescue-team control.
- `src/shell/decisionEvents.ts` and its test: tolerate unknown or incomplete event data without taking down the shell.
- `src/sim/runner.test.ts`: verify real dispatch/outcome events remain available for the panel.
- `docs/CHANGELOG.md`: add one stabilization entry.

## Task 1: Align core action support and transport affordances

**Files:** `src/worker/akAdapter.ts`, `src/worker/engines.test.ts`, `src/worker/host.test.ts`, `src/shell/Transport.tsx`.

- [ ] **Step 1: Add a failing core acceptance test for implemented boat failure.** In `src/worker/engines.test.ts`, add:

```ts
it('accepts boat failures that the AK runner implements', () => {
  const engine = new CoreEngine(mockScenario(), 5, {
    dispatchMode: 'negotiation',
    npcParams: DEFAULT_NPC_PARAMS,
    maxTicks: 20,
    startTimeSeconds: 28_800,
  });

  expect(engine.rejects({ kind: 'boat_failure', t: 1, target: 1 })).toBeNull();
});
```

- [ ] **Step 2: Run the test and confirm it fails because the core allowlist rejects `boat_failure`.**

Run: `pnpm exec vitest run src/worker/engines.test.ts --reporter=verbose`

Expected before the fix: the new test fails with the current “not modelled by the core” reason.

- [ ] **Step 3: Add only `boat_failure` to `CORE_INJECTABLE`.** The set in `src/worker/akAdapter.ts` must include:

```ts
  'boat_failure',
```

Keep `rescue_teams_deployed` out of the allowlist because the AK runner does not implement its dynamic release semantics.

- [ ] **Step 4: Re-run the focused test and add a precise limitation for dynamic release.** Update `CoreEngine.rejects` so it returns the specific conversion error for `rescue_teams_deployed` instead of the generic unsupported-event message. Add an assertion in `src/worker/engines.test.ts` that this action is refused without mutating the run.

Run: `pnpm exec vitest run src/worker/engines.test.ts --reporter=verbose`

Expected: the boat-failure acceptance and explicit dynamic-release refusal tests pass.

- [ ] **Step 5: Make the transport control honest on core runs.** In `src/shell/Transport.tsx`, read `engine` from `useSceneStore`; disable the “Release rescue teams” button when `engine === 'core'`, retain the control in preview mode, and set its `title` to explain that core boats dispatch automatically but dynamic team release is not implemented. Keep the current playing/run controls enabled.

## Task 2: Make playback slices responsive and contain worker faults

**Files:** `src/worker/host.ts`, `src/worker/host.test.ts`.

- [ ] **Step 1: Extend the manual test clock.** Add `jump(ms)` to advance its monotonic time without running queued tasks, and `runNext()` to execute exactly one queued task. Preserve existing `advance(ms)` behavior.

- [ ] **Step 2: Add the catch-up responsiveness regression test.** In `src/worker/host.test.ts`, use the preview engine for speed, jump the manual clock forward 20 seconds at 64×, execute one scheduled playback callback, and assert that the live tick advances by no more than the playback slice limit (8 ticks). Send `pause`, run the next queued task, advance another second, and assert that `liveTick` remains unchanged.

Run: `pnpm exec vitest run src/worker/host.test.ts --reporter=verbose -t "pause remains responsive during playback catch-up"`

Expected before the fix: one callback advances the full 240-tick frame cap, so the 8-tick assertion fails.

- [ ] **Step 3: Add a scheduled-engine-fault test.** Construct `SimHost` with an engine factory that returns a `PreviewEngine` subclass whose `step()` throws `Error('synthetic step fault')`. Load, start playback, and execute the scheduled callback. Assert the host posts one error, posts status with `playing: false`, does not schedule an endless loop, and accepts a subsequent `load` to restart.

Run: `pnpm exec vitest run src/worker/host.test.ts --reporter=verbose -t "contains a playback worker fault"`

Expected before the fix: the scheduled callback throws out of the clock and no contained error/status is posted.

- [ ] **Step 4: Apply the minimal host fix.** Limit normal playback to at most 8 simulation steps per scheduled callback, preserve no more than 240 pending ticks across callbacks, and wrap scheduled `loop()` execution. On a thrown runtime fault, cancel the timer, set `playing` false, clear transient busy state, emit an `error`, then emit status. Keep manual `step` and the existing 40 ms seek/injection catch-up loop unchanged.

- [ ] **Step 5: Re-run both regression tests and existing playback/seek tests.**

Run: `pnpm exec vitest run src/worker/host.test.ts --reporter=verbose -t "pause remains responsive during playback catch-up|contains a playback worker fault|seeks backwards through recorded frames|preview city on core" --testTimeout=60000`

Expected: all selected tests pass; slow unrelated full-template tests are skipped by the name filter.

## Task 3: Keep the decision timeline resilient and connected to real outcomes

**Files:** `src/shell/decisionEvents.ts`, `src/shell/decisionEvents.test.ts`, `src/sim/runner.test.ts`.

- [ ] **Step 1: Add a malformed/future-event regression case.** In the decision selector test, pass a runtime event with an empty or non-string `reason` using a narrow test cast alongside normal events. Assert the selector ignores it and still returns the valid dispatch decision.

Run: `pnpm exec vitest run src/shell/decisionEvents.test.ts --reporter=verbose`

Expected before the fix: selector evaluation throws while calling `.trim()` on the malformed event.

- [ ] **Step 2: Guard the reason at the event boundary.** Reject entries unless `typeof event.reason === 'string'` and `event.reason.trim().length > 0`. Do not change valid event ordering, stable keys, or the allowlisted real decision types.

- [ ] **Step 3: Verify a real core run emits decisions consumed by the panel.** Keep the existing real-run assertions for `ASSIGNED` and `HOSPITAL_ASSIGN`; add focused assertions for configured boat/police outcomes only where the fixture actually has staffed units and reachable targets. Assert their `reason` values are non-empty and their event types are included by `selectDecisionEvents`.

Run: `pnpm exec vitest run src/sim/runner.test.ts src/shell/decisionEvents.test.ts --reporter=verbose -t "boat|police|hospital|decision|assignment" --testTimeout=60000`

Expected: seeded core outputs contain the selected real decisions; no mock event is required.

## Task 4: Integrated verification and demo readiness

**Files:** `docs/CHANGELOG.md`; no broad renderer or contract rewrite.

- [ ] **Step 1: Add a concise changelog entry** describing responsive worker playback, explicit unsupported rescue release, accepted boat-failure injection, and fault containment.

- [ ] **Step 2: Run boundary-focused tests.**

Run: `pnpm exec vitest run src/worker/engines.test.ts src/worker/host.test.ts src/shell/decisionEvents.test.ts src/sim/runner.test.ts --reporter=verbose --testTimeout=60000`

Expected: 0 failures. If an unrelated long scenario times out, report it distinctly and run the named integration regressions individually.

- [ ] **Step 3: Run project checks.**

Run: `pnpm lint`

Expected: exit 0.

Run: `pnpm typecheck`

Expected: exit 0.

Run: `pnpm validate`

Expected: all checked scenarios validate.

Run: `pnpm build`

Expected: exit 0.

- [ ] **Step 4: Verify the app in the browser.** Start or reuse `pnpm dev`, open the demo, start a storm on the core engine, pause, resume, seek backward and return live, and confirm the decision panel receives at least one real dispatch outcome. Verify the rescue-release control is visibly disabled with its explanation on core, and confirm the shell stays mounted after a refused action or worker error.

- [ ] **Step 5: Review the final diff and status.** Run `git diff --check` and `git diff --cached --check`; confirm there are no unmerged paths and preserve unrelated staged/unstaged files.
