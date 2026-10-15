# AK Foundation Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Track steps below; retain evidence in docs/AK_STATUS.md.

**Goal:** Repair the scaffold and start AK's simulation with validated contracts and a tested headless foundation.

**Architecture:** Shared schemas and mocks feed a pure deterministic world. Navigation,
flood and power are independent functions; a fixed-order runner emits snapshots,
events and metric frames. UI integration stays in AJ's lane.

**Tech Stack:** TypeScript strict, Zod 4, Vitest 5, tsx, pnpm, existing Next.js 16.

## Checkpoint 0: repository and execution tooling

- [x] Pull main using `git pull --ff-only origin main`; branch `codex/ak-foundation`.
- [ ] Resolve AGENTS.md by retaining both instruction blocks.
- [ ] Standardize packageManager and install with `pnpm install`.
- [ ] Add `test`, `typecheck`, `validate`, `sim:batch`, `sim:compare`, `health` scripts.
- [ ] Read installed Next.js guides before any Next.js configuration fixes.
- [ ] Record commands and commit local checkpoint after gates pass.

## Checkpoint 1: frozen contracts and fixtures

Files: src/contracts/{types,schemas,messages,index}.ts, src/contracts/mocks/index.ts,
src/contracts/contracts.test.ts, docs/CONTRACTS.md, docs/REQUESTS.md.

- [ ] Write tests: mockScenario parses; invalid dimensions/reference/overlap fail;
      unknown commands and nested patches fail; snapshots own independent buffers.
- [ ] Run `pnpm test src/contracts/contracts.test.ts` and capture missing module failure.
- [ ] Implement types, schema refinements, worker messages, and labelled mock fixtures.
- [ ] Run focused tests, `pnpm typecheck`; update contract decisions and CHANGELOG.
- [ ] Commit reviewed contracts checkpoint.

## Checkpoint 2: deterministic world and navigation

Files: src/sim/{rng,world/grid,nav/pathfinding}.ts plus colocated tests.

- [ ] Test seeded sequences, seed validation, bounds and neighbour row boundaries.
- [ ] Test shortest safe routes, disconnected targets, stable ties and flow fields.
- [ ] Run tests before implementation, then implement typed-array world and routing.
- [ ] Enforce purity/determinism through ESLint; test forbidden imports and globals.
- [ ] Run `pnpm health`; record evidence, review and commit checkpoint.

## Checkpoint 3: headless flood/power slice

Files: src/sim/{weather/timeline,flood/solver,power/grid,runner,index}.ts,
scripts/{batch,compare,validate-scenarios}.ts with tests.

- [ ] Test interpolation and malformed timelines, closed-basin conservation, drainage,
      no negative water, source accounting, substation cascades and generator exhaustion.
- [ ] Test runner seed replay, termination, zero-route-violation metrics and snapshots.
- [ ] Implement modules after observed red tests. Keep runBatch(scenario,seeds,mode).
- [ ] CLIs validate JSON scenarios; use explicitly labelled contract mock if none exist.
      Comparison reports both modes but labels dispatch unavailable until M3.
- [ ] Run full health, build, HTTP probe, batch and compare; inspect produced summaries.
- [ ] Update README, ARCHITECTURE, SIM_SPEC, ROADMAP, AK_STATUS and CHANGELOG with
      implemented vs planned boundaries. Review and commit verified checkpoint.

## Continuing AK scope

Full M1 agents/traffic, M3 requests/beliefs/dispatch/hospital/aircraft, M4 patch verification,
and M5 stress integration remain required follow-on work. Do not claim full milestones
complete from unit foundation tests; preserve their original requirements.
