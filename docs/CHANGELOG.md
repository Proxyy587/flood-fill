# CHANGELOG
One line per change. Contract changes are marked **[CONTRACT]**. Pipeline-order changes are marked **[ADR]**.

- 2026-10-15 (AK, checkpoint 0): pulled main to 181ea06; resolved AGENTS merge markers retaining both guides; approved staged foundation plan; replaced the Bun lockfile with pnpm-lock.yaml and standardized pnpm 10.28.0/Node 24, ESM, Vitest 5 and Zod 4. Added command entries, dependency build allowlist and Next.js type generation before strict checking. Install, lint, typecheck and initial 63 tests verified; headless commands await checkpoint 3.

- (init) Docs created.
- Reorganized project tree: moved architecture and specification documents into `docs/` and worker role briefs into `workers/` to match `AGENTS.md` layout.
- Restored power cuts (substation flood trips, cascading blackouts, hospital generator fallback) and helicopters (rooftop rescues, medevac, wind limits) into core MUST scope across roadmap milestones M1-M5 and removed them from cut lines.
- **[CONTRACT]** Added power events (`BLACKOUT_ZONE`, `GENERATOR_START`, `GENERATOR_EXHAUSTED`, `SIGNAL_DARK`), helicopter events (`HELI_DROPOFF`, `ROOFTOP_RESCUE`, `MEDEVAC`, `HELI_GROUNDED_WIND`), and `heliRescues` to `MetricsFrame`.
