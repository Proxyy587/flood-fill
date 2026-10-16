# Laya decisions in simulation runs

Approved direction: integrate Laya now while keeping core safety and replay deterministic.

## Decision boundary

The browser asks the pinned ONNX model, before a run, for (1) negotiation versus centralised ambulance dispatch and (2) one preferred hospital for each synthetic injury tier. A versioned run tape stores those four categorical outputs, the model revision, seed and scenario fingerprint. Model probabilities are displayed as uncalibrated output.

The main sim worker receives the tape with run options. The core runner uses its dispatch choice and considers a preferred hospital only after the existing capacity, power, flood and route filters produce feasible candidates. When the preferred hospital is unavailable it chooses the original deterministic first candidate. It records the tape in `RUN_STARTED` and explains each applied hospital preference in `HOSPITAL_ASSIGN`. Headless runs with the same scenario, seed and tape remain identical. Preview runs ignore hospital preferences and display that limitation.

## Browser flow

The Scenario panel has an opt-in **Prepare Laya decisions** action. It loads the local model once, requests the four decisions, and displays them before application. **Use for next run** applies the tape to run settings. Editing the scenario or changing its seed invalidates the tape. Model load, invalid output, or inference failure leaves existing settings intact. Normal runs do not download the model.

## Limits

This is a run-start policy, not a per-tick model call. The model cannot allocate a bed, bypass a closed road, or override the existing safety checks. The official checkpoint is unvalidated for flood rescue; a model probability does not represent rescue success. The UI retains the simulation-output warning.

## Verification

Tests cover bounded model questions, tape validation/invalidation, preferred-hospital fallback, deterministic replay, and preserved safety invariants. Typecheck, lint, build, and a browser run confirm the real model path.
