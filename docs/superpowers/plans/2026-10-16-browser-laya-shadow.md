# Browser Laya Shadow Decisions Implementation Plan

> **For agentic workers:** Work through these checked steps in order; keep the simulator's committed choices deterministic.

**Goal:** Run the official Laya model through browser ONNX and show a real, bounded hospital-choice comparison in a browser diagnostics path.

**Architecture:** A dedicated inference worker owns model loading and prediction. A small client wrapper correlates requests and rejects stale replies. The existing pure hospital selector supplies feasible candidates and its deterministic choice; Laya only shadows that decision. Model files are generated locally from the pinned official checkpoint and remain outside Git.

**Tech Stack:** TypeScript, Next.js 16 App Router, Laya TypeScript runtime, ONNX Runtime Web, Vitest.

---

### Task 1: Pin and prepare Laya

**Files:** `package.json`, `pnpm-lock.yaml`, `scripts/prepare-laya-model.ps1`, `.gitignore`, `docs/LAYA_BROWSER.md`.

- [ ] Pin the official `laya-ts` Git repository subdirectory to an exact commit; add `onnxruntime-web`.
- [ ] Document and script the official split-ONNX export into `public/models/laya` from an exact official model revision, without committing weights.
- [ ] Verify the exported bundle has `encoder.onnx`, `head.onnx`, `tokenizer.json`, and `rl_agent_config.json` and records its source revision.

### Task 2: Browser inference boundary

**Files:** `src/ai/decisions/laya.worker.ts`, `src/ai/decisions/layaClient.ts`, `src/ai/decisions/layaClient.test.ts`.

- [ ] Write failing tests for request correlation, stale-generation rejection, malformed probability rejection, and worker-load failure.
- [ ] Implement lazy model loading and typed choice questions using the official browser runtime.
- [ ] Keep model inference off the UI and simulation threads; measure time in the inference worker.

### Task 3: Hospital shadow comparison

**Files:** `src/ai/decisions/hospitalShadow.ts`, `src/ai/decisions/hospitalShadow.test.ts`, `src/ui/critic/LayaDiagnostics.tsx`, `app/laya/page.tsx`.

- [ ] Write a failing test that only safe, reachable hospitals appear as model options, and that an unknown returned choice cannot become a committed decision.
- [ ] Derive a small candidate set from the existing pure hospital selection inputs and display deterministic versus Laya choice in an opt-in `/laya` diagnostics path.
- [ ] Show download/loading state, inference time, confidence distribution, unavailable-model fallback, and the simulation-output limitation label.

### Task 4: Verification and handoff

**Files:** `docs/CHANGELOG.md`, `docs/REQUESTS.md`.

- [ ] Run focused tests, typecheck, lint, and a browser smoke test with local model assets.
- [ ] Record existing unrelated baseline failures separately from new failures.
- [ ] Document that live assisted decisions require AK/AJ approval of the versioned worker contract and decision tape before wiring into the running city.
