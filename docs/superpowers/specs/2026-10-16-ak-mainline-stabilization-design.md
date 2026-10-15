# AK Integration Stabilization Design

## Goal

Restore a reliable playable app on top of AJ's latest `main` runtime while keeping AK's real simulation decisions visible and active. Playback, dispatch, rendering, and the decision timeline must share one validated worker path; an unsupported action must be explicitly unavailable rather than appearing to work or silently switching to preview behavior.

## Current evidence

- `origin/main` is currently `ac20307` and is an ancestor of the AK integration branch. AJ's worker host and renderer therefore remain the base; no reset of the current tree is needed.
- The active runtime path is `createSimWorker → src/worker/sim.worker.ts → SimHost → CoreEngine → src/worker/akAdapter.ts → createSimulation`.
- The current working changes switch the UI and host defaults from `preview` to `core`.
- The transport still exposes “Release rescue teams,” but the core adapter returns an unsupported-action error for `rescue_teams_deployed`. Its core-supported injection allowlist also omits `boat_failure` even though the AK runner accepts and handles that event.
- A separate `src/bridge/akSim.worker.ts` / `akSimAdapter.ts` path exists but is not used by the app. Maintaining two scenario and event translators risks semantic drift.
- The reported random crash has not yet been reproduced, so no specific crash cause is assumed in this design.

## Design

Keep AJ's `SimHost`, worker protocol, bridge, and renderer as the sole application runtime. Use one explicit UI-to-AK translation boundary (`src/worker/akAdapter.ts`) for scenario IDs, entrances, weather units, injected actions, events, snapshots, inspectors, and summaries. Do not add a second worker or change the shared UI contract.

The real AK core remains the source of ambulance, hospital, boat, police, escort, and crowd-control outcomes shown in the decision panel. Complete the adapter/runner path for supported boat failures and the existing rescue-team transport action. If a behavior truly is not implemented, disable its control with a clear explanation; do not accept it and then silently omit it, and do not silently fall back to preview.

Treat crashes and worker failures as contained run errors: preserve the shell, surface the diagnostic, and allow a clear restart. Keep the decision panel a read-only projection of actual worker events and make event parsing tolerant of unknown or incomplete future events.

## Verification

Add regression coverage at the boundaries that failed or are easy to drift:

- UI/AK scenario and event translation preserves building identities and targets, entrances, weather units, and supported injection payloads.
- Core worker load, play, pause, resume, seek/replay, and restart remain operational with AJ's protocol.
- Ambulance assignment, hospital reservation/diversion, boat rescue/failure, and police decisions reach the worker event feed and the decision timeline.
- Unsupported actions return a clear refusal without corrupting or terminating the run.
- A browser smoke run verifies the app mounts, a storm can be started/paused/resumed, and real decisions appear without uncaught runtime errors.

Run focused tests first, then lint, typecheck, scenario validation, build, and the broad test suite where runtime permits. Report any full-suite timeout separately from actual test failures.

## Scope and compatibility

This is a stabilization/integration slice, not a rewrite of AJ's renderer or the simulation algorithms. Keep contracts unchanged on the UI/worker boundary; only AK-internal types may be extended if required to implement an already-exposed action. Record any such change in `docs/CHANGELOG.md`.
