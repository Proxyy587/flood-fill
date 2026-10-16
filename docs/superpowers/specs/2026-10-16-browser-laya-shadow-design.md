# Browser Laya shadow decisions

Date: 2026-10-16. Approved direction: official Laya checkpoint, browser ONNX inference, hospital decisions in shadow mode first.

## Goal

Run Laya entirely in a dedicated browser worker and compare its bounded hospital choice with the deterministic simulator's committed choice. The model never controls beds, routes, movement, or dispatch in this slice. A failed or unavailable model leaves simulation behavior unchanged.

## Runtime boundary

- Keep `src/sim` pure and deterministic. It produces a stable list of feasible hospital candidates with route, capacity and power evidence at the point where it already chooses and reserves a bed.
- The browser worker lazily loads a pinned `laya-ts` source revision with ONNX Runtime Web. It fetches an official checkpoint exported to Laya's split ONNX format (`encoder.onnx`, `head.onnx`, tokenizer and config). WebGPU is attempted first; the upstream runtime falls back to WASM.
- A browser-side broker receives bounded candidate observations, caps outstanding work, and discards results from an old run generation. It records Laya's choice and distribution separately from the simulator's deterministic choice.
- A small diagnostics view shows model loading, the last shadow comparison, inference latency, and failures. It explicitly labels shadow output as unvalidated simulation evidence.

## Model assets

The official TypeScript browser example reports about 1.3 GB for its first split-model load, not the 25 MB in the older repo concept note. Do not commit model weights. Provide a reproducible export command from the official checkpoint and serve the generated files from `public/models/laya`. Loading is opt-in so normal gameplay never downloads the model unexpectedly.

## Safety and evidence

Only feasible candidate IDs can appear in a comparison. Validate finite probabilities and candidate membership. Preserve both existing dispatch modes. Shadow work is asynchronous and cannot delay a simulation tick. Tests cover candidate formation, stale responses, malformed results and offline behavior; a browser smoke path confirms real model loading when assets are installed.

## Follow-on gate

Assisted choices require separate review of the versioned worker contract and decision tape in `docs/CONTRACTS.md`, plus held-out accuracy and latency evaluation. The shadow slice does not claim Laya improves rescue outcomes.
