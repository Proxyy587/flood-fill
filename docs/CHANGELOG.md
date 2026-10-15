# CHANGELOG
One line per change. Contract changes are marked **[CONTRACT]**. Pipeline-order changes are marked **[ADR]**.

- (init) Docs created.
- Reorganized project tree: moved architecture and specification documents into `docs/` and worker role briefs into `workers/` to match `AGENTS.md` layout.
- Restored power cuts (substation flood trips, cascading blackouts, hospital generator fallback) and helicopters (rooftop rescues, medevac, wind limits) into core MUST scope across roadmap milestones M1-M5 and removed them from cut lines.
- **[CONTRACT]** Added power events (`BLACKOUT_ZONE`, `GENERATOR_START`, `GENERATOR_EXHAUSTED`, `SIGNAL_DARK`), helicopter events (`HELI_DROPOFF`, `ROOFTOP_RESCUE`, `MEDEVAC`, `HELI_GROUNDED_WIND`), and `heliRescues` to `MetricsFrame`.
