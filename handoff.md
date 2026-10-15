# AJ Integration Handoff: AK Simulation + Worker 1 Assets

**Prepared:** 2026-10-15
**Source branch:** `codex/ak-m3-reports`
**Included implementation commit:** `7bbf932` (`Merge branch 'w1/assets-and-templates' into codex/ak-m3-reports`)
**Status:** AK simulation and W1 deliverables are committed on this branch. Browser/runtime integration by AJ is still pending. This is not a release-readiness sign-off.

## What is included

### AK simulation

- Deterministic flood, power, navigation, population, traffic, evacuation and shelter-capacity simulation in the headless core.
- M3A uncertain reports: deterministic distress/false reports, delayed delivery, communications-outage buffering, confidence-based HQ belief, and owned snapshot projections.
- M3B ambulance response: one provisional incident per delivered report cluster, incident provenance, finite ambulance fleet, separate negotiation and centralized dispatch policies, scene verification, field triage, multiple casualties, powered-hospital bed reservations and severity-aware destination selection, plus adaptive hotspot staging.
- Synthetic-only inputs; no live feeds. No shared-contract changes were made for M3A/M3B.

### Worker 1

- Canonical voxel palette and `BLOCK_META` at `src/assets/palette.ts`.
- Procedural voxel models and registry at `src/assets/models/` (`MODELS`, `getModel`).
- Four generated templates—`riverside-town`, `coastal-grid`, `dense-basin-city`, and `stress-triple`—plus `scenarios/index.json` and `scripts/gen-scenarios.ts`.
- Templates are authored in the AK simulator format and validated with `src/contracts/ak` (the legacy simulator contract).

## AJ integration work

1. **Connect the real simulation to the worker bridge.** `src/bridge/createSimWorker.ts` still creates `mockSim.worker.ts`. There is no `src/sim/worker.ts` yet. Implement/coordinate the worker adapter for `MainToWorker` / `WorkerToMain` from `src/contracts/messages.ts`, preserving the simulator’s pure/headless boundary, snapshot ownership, pacing and deterministic seek behavior.

2. **Bridge the scenario contract boundary before wiring template loading.** W1 templates use AK fields such as injected-event `tick`, `vehicleId`/`buildingId`/`nodeId`, and physical wind speeds. `app/api/templates/route.ts` currently parses with the newer UI contract in `src/contracts/schemas.ts`, which expects different injected-event fields and normalized wind. The generator and asset tests intentionally validate against AK’s `src/contracts/ak` schema. Add and test an explicit adapter between these formats, or agree a compatible boundary with AK; do not silently rewrite the frozen simulator contract or drop event data. Test every generated template through the adapter and the worker load path.

3. **Adopt Worker 1’s palette.** `src/render/palette.ts` still defines render-local block/role/vehicle colors and explicitly marks the W1 palette as future work. Use `src/assets/palette.ts` / `BLOCK_META` as the canonical source while retaining render-only colors (water, selection, blackout tint, etc.) where appropriate. Check editor catalog duplication in `src/editor/catalog.ts` as part of that wiring.

4. **Adopt Worker 1’s models.** `src/render/entities/models.ts` still builds placeholder Three.js box geometries and says W1 models will replace them. Map registered voxel models to renderer geometries while preserving per-instance tinting, scale/origin conventions, disposal, and the helicopter rotor animation expected by the entity layer. Add geometry/model mapping tests.

5. **Exercise an end-to-end template run.** Load each template through the UI/worker boundary, run and pause/step it, and confirm reports, ambulance assignments, hospital reservations, events and snapshots appear in the renderer without mutating simulator-owned buffers. The stress template contains injected failures, but the full boat/police/helicopter response and complete compound-stress simulation are not yet implemented by AK.

## Verification already run on the source branch

- `pnpm health`: passed; 34 test files, 450 tests, lint and strict typecheck. Scenario validation reported four templates but is schema/presence validation only (`releaseReady: false`).
- `pnpm build`: passed.
- `pnpm exec tsx scripts/gen-scenarios.ts`: generated and validated all four templates against the AK simulator schema.
- Asset scenario tests include template schema checks and dry-road connectivity checks.

Re-run these after integration. Add a browser/worker smoke test; headless health/build alone do not prove runtime integration or release readiness.

## Remaining AK / project scope (not implied complete by this handoff)

- Add boat, police and helicopter response (including rooftop rescue and medevac), then implement and verify the full simultaneous-failure stress run.
- Finish the M4 critic-to-human-approved-patch-to-rerun verification loop and M5/M6 demo hardening.
- Resolve the outstanding navigation/metrics requests and complete independent review/release gates.
- Refresh `docs/AK_STATUS.md`, `docs/ROADMAP.md` and stale entries in `docs/REQUESTS.md`; they do not yet consistently reflect the pushed AK M3B and W1 state.

## Guardrails

- Keep `src/sim` pure and deterministic; use seeded RNG only.
- Treat `src/contracts` as the shared boundary; use an explicit adapter for the AK simulator/UI contract split and document any approved contract change.
- Renderer consumes snapshots and must not mutate simulation state. Keep edits through editor commands.
- Use synthetic data only. This is a simulation, not emergency-planning authority.
- AJ-owned renderer/bridge/editor changes should be made and reviewed in AJ’s integration lane; this handoff does not alter AJ’s worktree.
