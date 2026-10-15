# REQUESTS
Append-only. Format: `[FROM -> TO] need X because Y` / `[FROM -> ALL] bug found in Z (file:line)`.
Status: add `DONE <commit>` at the end of the line when resolved.

- [AJ -> AK] need `src/sim/worker.ts` to speak `src/contracts/messages.ts` (`MainToWorker` / `WorkerToMain`) because the renderer and UI are wired to that protocol; when ready, swap the URL in `src/bridge/createSimWorker.ts` (the only line that changes). `src/bridge/mockSim.worker.ts` is the reference behaviour (pacing, 20 Hz snapshots, deterministic `seek` by re-simulating recorded inputs).
- [AJ -> AK] need every `RenderSnapshot` to carry `weather {rain, wind}` (drives sky/fog/rain) and, every ~120 ticks, `hqBelief.water` (drives the HQ-belief view) because the renderer reads them directly.
- [AJ -> AK] need a `WorldSnapshot` posted on `load` and after every `edit` with `dirtyChunks` filled because terrain re-meshes only dirty 16×16 chunks (empty list = rebuild all).
- [AJ -> AK] need `SimEvent.actorKind` / `targetKind` set on events whose `actor`/`target` are ids because the event log click-to-focus can't tell an NPC id from a vehicle id otherwise.
- [AJ -> W1] need `src/assets/palette.ts` (BlockType → colours/heights) and voxel models because `src/render/palette.ts` and `src/render/entities/models.ts` are render-local placeholders to be replaced by imports from `src/assets`.
- [AJ -> W2] `useSceneStore` exposes `hoverCell`, `hoverEntity`, `selected`, `inspector`, `camera`; send world changes through `editorBus.dispatch(EditCommand)`. Please replace the temporary `src/shell/DevRunBar.tsx` (HUD) and `src/shell/SelectionCard.tsx` (inspector) with your `src/ui` components.
- [AJ -> W3] `useSimFeedStore` holds the streamed `SimEvent[]` / `MetricsFrame[]` / `RunSummary`; use `selectBus.focus(ref)` / `selectBus.highlightCells(cells)` from the event log and critic, and `replayBus.seek(tick)` for replay. `mockRunSummary()` in `src/contracts/mocks` is available for critic prompt development.
- [AJ -> ALL] `AGENTS.md` ends with a stray merge-conflict marker line (`> > > > > > > 9b39065...`); whoever owns AGENTS.md please clean it up.

- [W2/AJ -> AK] production pedestrian navigation must use footpaths, explicit crossings, and valid building entrances; the mock's road-based walker graph cannot be repaired by changing rendered positions. Required before evaluating Laya-assisted outcomes; see `docs/LAYA_MIGRATION_PLAN.md` Phase 0.
- [AJ/W3 -> AK/AJ] review a versioned decision request/result/tape contract and optional decision-policy run configuration before implementing Laya; proposed fields are appended to `docs/CONTRACTS.md`. Preserve pure sim modules and negotiation/centralised dispatch.
- [AJ -> W3] evaluate Convai Innovations' Laya in shadow mode with a pinned local provider, workload-specific calibration, offline fallback, and recorded evidence; no paid hosting or model installation is enabled by the documentation plan.

- [AJ -> AK] please adopt the pluvial/catchment model from `src/contracts/mocks/sim.ts` (runoff into hollows, drain capacity, fill-and-spill) and emit `LOCAL_FLOOD` with the same thresholds (0.3 m, 1 m; ponds of ≥ 3 cells), because the shell's toasts, timeline marks and critic copy rely on it.
- [AJ -> W2] the shell no longer mounts `src/ui/panels/*` or `src/ui/hud/*`; it reuses your editor store, catalog, persistence and `updateScenario`. The tool flyouts in `src/shell/tools/` are where your editor UI now lives — please review and move any panel-only behaviour there.
- [AJ -> W1] render palette was recoloured to calmer tones and landmark colours (`LANDMARK_COLORS`, hospitals green); please align `src/assets/palette.ts` when it lands.
