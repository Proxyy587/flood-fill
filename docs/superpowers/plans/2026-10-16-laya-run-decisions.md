# Laya Run Decisions Implementation Plan

> **For agentic workers:** Execute inline in this task; user requested rapid implementation. Use focused red-green tests for behavior changes.

**Goal:** Apply browser Laya choices to real run-start dispatch and hospital decisions with deterministic replay and safety fallback.

**Architecture:** A pure browser-side policy builder creates a versioned tape from bounded model choices. The existing sim worker carries it as a run option. The pure core sim validates candidate hospitals again at the point of reservation, records the choice, and falls back to its deterministic selector when needed.

**Tech Stack:** TypeScript, Next.js, Laya ONNX browser worker, Vitest.

---

### Task 1: Decision tape and browser model requests

**Files:** `src/contracts/laya.ts`, `src/ai/decisions/runTape.ts`, `src/ai/decisions/layaClient.ts`, `src/ai/decisions/layaWorkerCore.ts` and tests.

- [ ] Test a model reply with dispatch IDs and bounded instructions, rejecting unknown IDs and stale replies.
- [ ] Test tape fingerprinting, model choice validation and safe fallback when a scenario changes.
- [ ] Implement four run-start choices with a versioned tape and capped candidate count.

### Task 2: Apply choices in the pure simulator

**Files:** `src/contracts/messages.ts`, `src/contracts/types.ts`, `src/contracts/sim-schemas.ts`, `src/worker/{host,engines}.ts`, `src/sim/{runner,dispatch/hospitals}.ts` and tests.

- [ ] Test that a feasible preferred hospital is used, an unsafe one is rejected, and identical tapes yield identical event logs.
- [ ] Carry the tape through the worker's run options to the core runner; validate it at the boundary.
- [ ] Record model policy in the start event and applied hospital choices with reasons.

### Task 3: User flow and verification

**Files:** `src/ui/critic/LayaRunSetup.tsx`, `src/shell/tools/ScenarioTool.tsx`, `src/bridge/sceneStore.ts`, `src/shell/FloodSimApp.tsx`, `docs/{CONTRACTS,CHANGELOG,LAYA_BROWSER}.md`.

- [ ] Show opt-in load/prepare/apply states, dispatch choice and hospital preferences; clear a stale tape.
- [ ] Pass applied tape on core runs and show preview limitation.
- [ ] Run focused tests, typecheck, lint, build and browser smoke; update contract and provenance docs.
