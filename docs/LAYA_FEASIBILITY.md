# Laya: initial feasibility and cost report

Date checked: **15 October 2026**. Status: research and proposed design; no Laya dependency, model download, paid account, or inference service has been installed or enabled.

## Recommendation

**Proceed with a local, offline evaluation and a shadow-mode prototype. Do not replace the simulator's safety checks or enable Laya as the sole decision authority.** Start on existing hardware with no model/API fee. Consider paid hosting only after measuring accuracy, memory, and throughput on FloodSim scenarios.

This report identifies “Laya” as **Convai Innovations' decision model**, distributed as [`convaiinnovations/laya`](https://huggingface.co/convaiinnovations/laya) and the [`NandhaKishorM/laya` reference implementation](https://github.com/NandhaKishorM/laya). It is unrelated to the LayaAir rendering engine.

## What fits this project

Laya returns bounded choices, ordinal scores, and yes/no probabilities rather than generating prose. Its reference code and model are published under Apache-2.0. This is a plausible fit for selecting among a few already-feasible actions; it does not supply flood physics, routes, a city model, or resource reservations. [Official model card](https://huggingface.co/convaiinnovations/laya), [reference repository](https://github.com/NandhaKishorM/laya).

Our proposed first experiment is **hospital selection among at most five feasible candidates plus defer**. The existing deterministic rules generate the candidates, calculate route and capacity information, and retain final control. Later experiments can cover report verification, evacuation choices, or dispatch bids. This is our engineering recommendation, not a measured capability of Laya on flood rescue.

The published typed-decisions results distinguish a specialised checkpoint from base checkpoints; the base models fall below that benchmark's majority-class baseline. The maintainers also warn about calibration, option order, language, label count, and task transfer. Therefore, published accuracy does **not** establish flood-rescue accuracy. A restricted answer format can still return an incorrect answer. [Official benchmark limitations](https://nandhakishorm.github.io/laya/benchmarks/).

## Compatibility with the current code

The app currently selects `src/bridge/mockSim.worker.ts`, which drives `ScenarioPreview` and `MockSim`. There is no production `src/sim` implementation or installed Laya integration. `MainToWorker` / `WorkerToMain` contain no inference request/result messages. The existing inspector already has `lastDecision`, alternatives, and a reason, which provides a useful UI starting point.

Keep Next.js, TypeScript, three.js, the editor, and the worker boundary. Add a server-side provider adapter and a separate inference process. The official HTTP service exposes `POST /v1/systemone`; this makes an HTTP adapter a practical first integration without moving Python or networking into the simulation. The server exposes authentication and concurrency controls, and its health endpoint alone does not prove that a checkpoint is loaded and ready. [Official HTTP API](https://nandhakishorm.github.io/laya/http-api/).

The reference repository also advertises `laya-ts` for TypeScript/Node/browser use. That is an alternative to evaluate, not a reason to rewrite the renderer. Browser inference would share device resources with the 3D scene; benchmark that separately before choosing it. [Reference repository](https://github.com/NandhaKishorM/laya).

**Laya will not fix pedestrians walking on roads.** Sidewalk topology, crossing permissions, entrances, traffic queues, and physically valid movement must be implemented in AK's simulation first. Model evaluation against the mock can test the adapter, but cannot validate real-world behaviour.

## What is free, and what can cost money

All amounts below are USD before taxes. Monthly compute examples use **730 running hours, one replica**; they exclude app hosting, additional storage, data transfer, engineering time, and any required account subscription. These are published infrastructure rates and arithmetic examples, not a tested Laya deployment quote.

| Option | Published charge / example | Assessment |
|---|---|---|
| Deterministic rules and recorded demo decisions | No model/API fee | Always keep this available. |
| Laya on an existing local computer | No Laya licence or per-inference fee | Lowest cash-cost starting point; electricity, RAM, disk, and setup effort remain. |
| Hugging Face dedicated AWS CPU, 4 vCPU / 8 GB | $0.134/hour; **$1.34 for 10 hours**, **$97.82 for 730 hours** | Illustrative CPU hosting; actual memory and speed need validation. |
| Hugging Face dedicated AWS T4 | $0.50/hour; **$5 for 10 hours**, **$365 for 730 hours** | GPU option if measured CPU throughput is insufficient. |
| Optional Jev hosted alternative | **$0.042 per million input tokens; output free** | Different provider, not a Laya hosting fee. Useful only as an optional comparison. |

Laya licensing: [official model](https://huggingface.co/convaiinnovations/laya). CPU/GPU rates and billing: [Hugging Face Inference Endpoints pricing](https://huggingface.co/docs/inference-endpoints/pricing). Jev rate: [TypeSafe model pricing](https://docs.typesafe.ai/models).

Do not describe all Hugging Face hosting as free: CPU Basic Spaces have no hourly hardware fee, but current docs say creating a new compute Space requires a paid plan. Personal PRO is listed at **$9/month**. Static Spaces do not run the inference server. [Spaces hardware and account requirement](https://huggingface.co/docs/hub/spaces-gpus), [account pricing](https://huggingface.co/pricing).

The separately planned **after-run Anthropic critic** can also incur charges if enabled; Laya does not remove that bill. For illustration, current Sonnet 5.5 base rates are $2/M input and $10/M output tokens: a 6,000-input/1,000-output-token report would cost **$0.022**, before retries, caching modifiers, or other features. No critic model is selected by this report. The existing analyser-only report path avoids this API fee. App hosting, an optional domain, monitoring, and storage remain separate deployment choices. [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing).

The official Docker CPU quickstart asks for **8 GB RAM and 10 GB free disk**. That is service setup guidance, not a guarantee that the browser, Next.js, renderer, and inference all fit comfortably together. Our initial workstation budget is 16 GB total RAM, subject to measurement; CPU operation avoids buying a GPU. Cache/preload the selected checkpoint before a demo. [Official Docker quickstart](https://nandhakishorm.github.io/laya/docker/).

Fine-tuning, if the held-out tests justify it, introduces dataset preparation and training-compute costs. No mandatory training fee was identified for local Laya use. Free notebook quotas or hardware grants should be treated as optional resources with eligibility and availability limits, not a production budget assumption.

## Workload and API-cost examples

Do not call a model for every NPC on every tick: **600 agents × 3,600 ticks = 2,160,000 decisions per simulated hour**. Even free local inference can be too slow at that volume. Use event-triggered requests, a bounded shortlist, batching, cooldowns, and an explicit per-run budget.

For the optional Jev comparison, assume **500 total billable input tokens per request**, including the charged state/questions, no retries, and the published $0.042/M input rate:

| Requests | Input tokens | Calculated API charge |
|---:|---:|---:|
| 120 | 60,000 | $0.00252 |
| 1,000 | 500,000 | $0.021 |
| 10,000 | 5,000,000 | $0.21 |

Formula: `requests × actual billed input tokens per request × 0.042 / 1,000,000`. Real usage must come from provider usage records; additional questions, retries, repeated runs, and larger observations change the total. The examples are not a promise of throughput, credits, or account eligibility. [TypeSafe pricing and rate limits](https://docs.typesafe.ai/models).

## Conditions for moving beyond a prototype

1. A production deterministic simulation with tested navigation and resource invariants exists.
2. The adapter passes schema, timeout, stale-response, invalid-choice, and offline-fallback tests.
3. Calibration and accuracy are measured on held-out synthetic flood cases, including contradictory reports and simultaneous failures.
4. Shadow mode shows acceptable latency and errors; bounded simulation trials show no invariant violations and no unacceptable fairness or service regression.
5. Every applied result is recorded for replay. Online inference is not claimed to be reproducible from the seed alone.

**Initial verdict:** feasible and potentially affordable for sparse, bounded decisions; feasible with **$0 model/API fees locally** on suitable existing hardware. Not yet validated for FloodSim decision quality, all-agent real-time inference, or actual emergency operations. Follow [LAYA_MIGRATION_PLAN.md](LAYA_MIGRATION_PLAN.md) for the execution sequence.
