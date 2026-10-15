# CHANGELOG
One line per change. Contract changes are marked **[CONTRACT]**. Pipeline-order changes are marked **[ADR]**.

- 2026-10-15 (AK, documentation checkpoint): recorded source commit 7c19583 and tooling commit d077579; closed the foundation plan and review ledger, with 209 passing tests, build, committed-source batch/compare smoke and HTTP 200 evidence. Full roadmap, absent templates/browser integration and inherited development advisory remain explicitly open.

- 2026-10-15 (AK, source checkpoint verification): full health passes 209 tests plus lint, generated Next.js route types, strict TypeScript and schema validation; production build passes after final review fixes. Five-area review rechecks recorded in AK_REVIEW.md; whole AK roadmap remains active.

- 2026-10-15 (AK, final review fixes): covered all supported sim source extensions in purity/determinism guards; reject sparse/oversized batch seed lists; bound fleet/staff allocation including civilian cars; made schema-only validation explicitly insufficient for release readiness. Reconciled worker changelog/generator/playground permissions, pnpm health merge gates, all five stress failures and initial/deferred critic whitelists. Generator restart/exhaustion events now remain accurate across interior flooding.

- 2026-10-15 **[ADR]** (AK): scheduled faults apply at state boundaries including initialization, before power propagation; source/weather sampling uses [tick,tick+1). Browser timing/postMessage stays in AJ's adapter outside pure src/sim. Corrected the layout instruction to remove the conflicting host-worker entry from the pure core.

- 2026-10-15 (AK, checkpoint 2): added run-scoped Mulberry32, independent typed-array world, deterministic heap A*/multi-target reverse Dijkstra and 94 exercised lint-guard cases. Navigation costs use bounded fixed-point values for exact path sums; grid limits match the scenario schema.
- 2026-10-15 (AK, checkpoint 3): added weather interpolation, mass-accounted virtual pipes with sill-safe momentum, drainage, BFS power cascades, generator fuel/diversion, createSimulation/runBatch and batch/compare/validation CLIs. Faults apply at their logged state boundary. Added regression tests for reviewer findings; full health reaches 193 passing tests. README/spec/architecture/roadmap/status distinguish implemented primitives from pending living city and dispatch work.
- 2026-10-15 **[CONTRACT]** (AK): added RUN_STARTED/RUN_FINISHED log boundaries and deterministic fleet ID ordering; reject undefined building tiles and unsafe Float32 input ranges. Foundation logs disclose unavailable agent/dispatch metrics.

- 2026-10-15 **[CONTRACT]** (AK, checkpoint 1): froze types/schemas/messages/mocks; numeric branded IDs and snapshot encodings; missing injected-event and worker protocol types; safe inspector IDs, footprint checks and nonrecursive patches. Added 15 boundary tests; docs record decisions and worker integration requests.

- 2026-10-15 (AK, checkpoint 0): pulled main to 181ea06; resolved AGENTS merge markers retaining both guides; approved staged foundation plan; replaced the Bun lockfile with pnpm-lock.yaml and standardized pnpm 10.28.0/Node 24, ESM, Vitest 5 and Zod 4. Added command entries, dependency build allowlist and Next.js type generation before strict checking. Install, lint, typecheck and initial 63 tests verified; headless commands await checkpoint 3.

- (init) Docs created.
- Reorganized project tree: moved architecture and specification documents into `docs/` and worker role briefs into `workers/` to match `AGENTS.md` layout.
- Restored power cuts (substation flood trips, cascading blackouts, hospital generator fallback) and helicopters (rooftop rescues, medevac, wind limits) into core MUST scope across roadmap milestones M1-M5 and removed them from cut lines.
- **[CONTRACT]** Added power events (`BLACKOUT_ZONE`, `GENERATOR_START`, `GENERATOR_EXHAUSTED`, `SIGNAL_DARK`), helicopter events (`HELI_DROPOFF`, `ROOFTOP_RESCUE`, `MEDEVAC`, `HELI_GROUNDED_WIND`), and `heliRescues` to `MetricsFrame`.
