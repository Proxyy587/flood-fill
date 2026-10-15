# AK execution checkpoints

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

Remaining: full M1 living-city agents/traffic, mode-specific hazard routing and
replanning; M3 uncertain reports/dispatch/hospital allocation/aircraft and safety
invariants; M4 patch verification; M5 full stress integration. AJ's worker/render
and W1 templates remain separate ownership dependencies. Goal remains active.
