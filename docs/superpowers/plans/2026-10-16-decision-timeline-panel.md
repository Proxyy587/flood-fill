# Live Decision Timeline Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make actual simulation decisions visible in a compact bottom-left timeline during a run.

**Architecture:** Run AK's deterministic simulator through a dedicated worker adapter that translates between the frozen UI protocol and AK runner contracts. Derive a chronological, newest-first list from worker-fed `useSimFeedStore.events`; filter to actionable decision/outcome events without synthesizing rationale. Render a run-only overlay in the shell, resolving building names from the existing city store and displaying each event's own `reason`.

**Tech Stack:** Next.js App Router, React, TypeScript, Zustand, CSS Modules, Vitest.

---

### Task 1: Define meaningful decision events

**Files:**
- Create: `src/shell/decisionEvents.ts`
- Test: `src/shell/decisionEvents.test.ts`

- [x] Add a pure selector that excludes non-decision telemetry and all events explicitly marked `data.mock === true`, keeps actual assignment, triage, hospital, boat, police, evacuation, rescue, and outcome events, and returns at most 6 newest events in descending tick order.
- [x] Test inclusion of actual `ASSIGNED`, `HOSPITAL_ASSIGN`, police-reason `ARRIVED`, boat/rescue and `SERVED` events; test exclusion of `WEATHER`, `RUN_STARTED`, and explicitly mocked events; test newest-first ordering and limit.
- [x] Run `pnpm exec vitest run src/shell/decisionEvents.test.ts` and verify it passes.

### Task 2: Render and mount the bottom-left timeline

**Files:**
- Create: `src/shell/DecisionPanel.tsx`
- Modify: `src/shell/FloodSimApp.tsx`
- Modify: `src/shell/shell.module.css`

- [x] Render only when the editor is in run mode; read events from `useSimFeedStore` and names from `useCityStore`.
- [x] Show event headline, simulated clock, the event's real `reason`, and the named hospital/building target when available. Clicking an event uses the existing `focusEvent` helper.
- [x] Keep the panel bottom-left, above the transport controls, accessible by keyboard, and scrollable on short screens. Empty state says that decisions will appear after the run starts.

### Task 3: Verify integration

**Files:**
- No additional files.

- [x] Run focused decision panel tests, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm validate`, and `pnpm build`.
- [x] Keep the shared UI contract unchanged; route the real AK runner through a dedicated adapter and display its emitted decision rationale.
