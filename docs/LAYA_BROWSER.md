# Browser Laya prototype

The opt-in `/laya` page runs the pinned official English Laya checkpoint through ONNX Runtime Web in a dedicated browser worker. It asks Laya to choose between feasible hospitals in a synthetic sample and compares the answer with the deterministic selector. This is a shadow demonstration; the running city still commits its own deterministic choices.

## Prepare the model

```powershell
python -m pip install "laya[onnx]==0.3.20" onnx onnxscript huggingface_hub hf_xet
python scripts/prepare-laya-model.py
pnpm dev
```

The script downloads `convaiinnovations/laya` at revision `55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851` and uses the upstream split ONNX exporter from `NandhaKishorM/laya` commit `4ac226d5ee88ed6df8db288a05c766d7a34ee682`. The exporter checks PyTorch and ONNX outputs before publishing files. It writes the graphs, tokenizer, config and provenance into `public/models/laya/`, which Git ignores. Run `/laya`, select **Load local model**, then **Ask Laya**. The first load is large and can take minutes; subsequent loads can use the browser cache.

The vendored `laya-ts` runtime in `vendor/laya-ts` is the built Apache-2.0 package from that commit. FloodSim carries browser packaging changes: detect a dedicated worker as a browser and use a literal `onnxruntime-web` import so Next's bundler includes it. Its Node provider is disabled in this browser-only vendor. The exporter uses Torch's modern ONNX path for a variable-length, batch-one decision head and verifies two sequence lengths. The upstream licence is retained.

## Boundaries

- A separate worker owns model weights and inference. Loading is opt-in; normal gameplay does not download model assets.
- The Laya request contains at most five already-feasible candidate labels. The client checks candidate membership, finite probabilities and a normalized distribution. Truncated model observations are rejected.
- Failed loads, invalid answers and old-generation replies do not alter the simulator. The page shows an unavailable state.
- The official checkpoint has **not** been calibrated for FloodSim decisions. A probability from this checkpoint is model output, not a measured rescue success probability.

## Next integration gate

`docs/CONTRACTS.md` requires AK/AJ review of a versioned decision request/result and tape before live worker messages or assisted dispatch are added. Until that review, `/laya` remains an isolated shadow lab. A live shadow should use real candidate snapshots from the sim, record generation/tick/version metadata, and compare on held-out synthetic runs before any model choice can be applied.

## Verification

On 2026-10-16, the pinned export passed Torch-versus-ONNX checks at the default and 512-token sequence lengths. A production Next build served the model in `/laya`; a real browser run selected Hospital 2 with probabilities 87.1% and 12.9% in 2178.4 ms after loading. Focused Laya and hospital tests, strict typecheck, lint, and production build passed. Lint still reports nine existing warnings in `src/render`.

The full test suite was already failing before this integration in `src/sim/runner.test.ts`, `src/bridge/akSimAdapter.test.ts`, an ESLint-rule test, and several render/editor test-file loads. These failures were not modified as part of the Laya slice.
