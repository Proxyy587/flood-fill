# AK execution checkpoints

## 2026-10-15 baseline

- Pulled main d5a990b → 181ea06 by fast-forward; clean checkout before work.
- Work branch: codex/ak-foundation. Approved design and plan in docs/superpowers/.
- Existing problems: committed AGENTS merge markers; pnpm/Bun mismatch; dependencies
  absent; missing contracts, sim, tests, schemas and runner commands.
- Baseline lint fails because eslint is not installed; there is no baseline test script.

## Active stage

Checkpoint 0 verified: pnpm install completed; Vitest runs without configuration
warning after enabling ESM, Node type peer aligned to runtime. Strict checking needs
`next typegen` before `tsc` (fresh checkout LayoutProps was otherwise undefined);
the installed Next.js CLI and TypeScript guides specify this exact sequence.
Lint and typecheck both pass; 63 contract/RNG/grid/navigation tests pass at this point.
The superseded Bun lockfile was removed; pnpm-lock.yaml is the reproducible lockfile.

Next stages: contracts/mocks review, deterministic navigation, headless flood/power.
The full living-city and dispatch roadmap is still pending; see ROADMAP.md.
