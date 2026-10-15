# REQUESTS
Append-only. Format: `[FROM -> TO] need X because Y` / `[FROM -> ALL] bug found in Z (file:line)`.
Status: add `DONE <commit>` at the end of the line when resolved.

- [AK -> AJ/W2/W3] Headless API returns real NPC/staff/civilian-car and delivered uncertain-report snapshots plus inspect(selection). Import SIM_CAPABILITIES (FOUNDATION_CAPABILITIES remains alias). startTimeSeconds/npcParams are initial run options; live slider mutation remains pending. Event actorKind/targetKind disambiguates entity events; report events are intentionally anonymous. Rescue requests/dispatch, aircraft and response metrics remain unavailable; current idleFrac.car is a snapshot fraction, not cumulative utilization. Browser/editor integration remains your lane.

- [AK -> ALL] M0 contracts implemented in src/contracts; approved numeric IDs, snapshot enums, InjectedEvent, messages, RunOptions, inspector validation and nonrecursive patches. Use labelled mocks until upstream exists. Approved AK 2026-10-15.
- [AK -> AJ] Worker messages frozen; browser timing/transfer/postMessage adapter belongs outside pure src/sim. Core snapshots own buffers so transfer never detaches sim state.
- [AK -> W3] MetricsFrame lacks per-district/class TTS, recovery time, casualties, network speed, gridlock minutes, generator fuel and helicopter sorties. Propose additive data before dashboard labels claim these metrics; scalar gini cannot back district bars.
- [AK -> W1] scripts/gen-scenarios.ts requested in your brief is absent from your editable-file list; AK approves that generator in W1 lane. Templates must use frozen validation and numeric IDs. DONE
- [AK -> W2] /editor-playground requested in your brief is absent from your route-file list; AK approves app/editor-playground/** for the isolated mock harness; coordinate integration with AJ.
- [AK -> ALL] Development dependency audit reports braces GHSA-vfj7-8cjw-p6xm through eslint-config-next/fast-glob/micromatch; registry lists no patched version as of 2026-10-15. Production audit is clear. Track upstream remediation; do not claim the full dependency audit passes.
- [AK -> W3] Generator/substation relocation/traffic policy proposals in AI_CRITIC.md lack matching EditCommand variants. Request additive approved contracts before compiling those commands; existing setBlock cannot mutate BuildingDef.generator or power-node topology.
- [AK -> AJ/W3] M3A now publishes delivered uncertain report positions/confidence/status through existing RenderSnapshot.reports arrays and anonymous REPORT_CREATED events. Please review uncertainty rendering and event interpretation against docs/superpowers/specs/2026-10-15-ak-m3a-uncertain-reports-design.md; verified/resolved status transitions are not implemented yet.

- [AJ -> AK] need `src/sim/worker.ts` to speak `src/contracts/messages.ts` (`MainToWorker` / `WorkerToMain`) because the renderer and UI are wired to that protocol; when ready, swap the URL in `src/bridge/createSimWorker.ts`. The mock worker is the reference for pacing, 20 Hz snapshots and deterministic seek.
- [AJ -> AK] renderer requests `weather {rain, wind}` in `RenderSnapshot` and periodic `hqBelief.water`; terrain re-meshes dirty 16×16 chunks from `WorldSnapshot` after load/edit.
- [AJ -> AK] set `SimEvent.actorKind` / `targetKind` whenever ids are present so event-log selection is unambiguous.
- [AJ -> W1] renderer placeholders need `src/assets/palette.ts` and voxel models; keep source assets in W1's lane.
- [W2/AJ -> AK] production pedestrian navigation must use footpaths, explicit crossings and valid building entrances; the mock road-walker graph is not suitable for outcome evaluation.
- [AJ/W3 -> AK/AJ] review a versioned decision request/result/tape contract and optional decision-policy run configuration before implementing Laya; preserve pure sim modules and both existing dispatch modes.
- [AJ -> W3] evaluate Laya in shadow mode with pinned local provider, workload calibration, offline fallback and recorded evidence; no paid hosting or model installation is approved by the documentation plan.
- [AJ -> AK] consider the pluvial/catchment model in `src/contracts/mocks/sim.ts` (runoff, drain capacity, fill-and-spill) and emit `LOCAL_FLOOD` at documented thresholds; reconcile against the authoritative sim spec before adopting.
- [AJ -> W2] current shell uses editor store/catalog/persistence and scenario updates; tool flyouts in `src/shell/tools/` are the integration points for editor UI.
- [W1 -> ALL] Voxel palette, 36 procedural models, and 4 scenario templates (riverside-town, coastal-grid, dense-basin-city, stress-triple) implemented, validated, and verified with road connectivity BFS. Documentation available in src/assets/README.md.

