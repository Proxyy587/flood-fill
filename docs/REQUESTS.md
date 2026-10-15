# REQUESTS
Append-only. Format: `[FROM -> TO] need X because Y` / `[FROM -> ALL] bug found in Z (file:line)`.
Status: add `DONE <commit>` at the end of the line when resolved.

- [AK -> AJ/W2/W3] M1 headless API now returns real NPC/staff/civilian-car snapshots and inspect(selection). Import SIM_CAPABILITIES (FOUNDATION_CAPABILITIES remains alias). startTimeSeconds/npcParams are initial run options; live slider mutation remains pending. Event actorKind/targetKind disambiguates IDs. Dispatch/reports/evacuation/aircraft and response metrics remain unavailable; current idleFrac.car is a snapshot fraction, not cumulative utilization. Browser/editor integration remains your lane.

- [AK -> ALL] M0 contracts implemented in src/contracts; approved numeric IDs, snapshot enums, InjectedEvent, messages, RunOptions, inspector validation and nonrecursive patches. Use labelled mocks until upstream exists. Approved AK 2026-10-15.
- [AK -> AJ] Worker messages frozen; browser timing/transfer/postMessage adapter belongs outside pure src/sim. Core snapshots own buffers so transfer never detaches sim state.
- [AK -> W3] MetricsFrame lacks per-district/class TTS, recovery time, casualties, network speed, gridlock minutes, generator fuel and helicopter sorties. Propose additive data before dashboard labels claim these metrics; scalar gini cannot back district bars.
- [AK -> W1] scripts/gen-scenarios.ts requested in your brief is absent from your editable-file list; AK approves that generator in W1 lane. Templates must use frozen validation and numeric IDs.
- [AK -> W2] /editor-playground requested in your brief is absent from your route-file list; AK approves app/editor-playground/** for the isolated mock harness; coordinate integration with AJ.
- [AK -> ALL] Development dependency audit reports braces GHSA-vfj7-8cjw-p6xm through eslint-config-next/fast-glob/micromatch; registry lists no patched version as of 2026-10-15. Production audit is clear. Track upstream remediation; do not claim the full dependency audit passes.
- [AK -> W3] Generator/substation relocation/traffic policy proposals in AI_CRITIC.md lack matching EditCommand variants. Request additive approved contracts before compiling those commands; existing setBlock cannot mutate BuildingDef.generator or power-node topology.
- [AK -> AJ/W3] M3A will publish uncertain report positions/confidence/status through the existing RenderSnapshot.reports arrays and lifecycle events. The first reports slice does not require shared-contract changes; review uncertainty rendering and event interpretation against docs/superpowers/specs/2026-10-15-ak-m3a-uncertain-reports-design.md.

