# M3A design: uncertain reports and HQ belief

## Goal and boundary

Implement the first M3 AK slice: deterministic synthetic distress reports with
uncertain locations, confidence, communication delay, duplicate/false reports,
and an HQ belief map. Reports make incomplete information observable; they do not
create rescue requests or dispatch units in this slice. M3B will connect verified
reports to requests and compare decentralized negotiation with the centralized
baseline. Helicopters and hospital balancing remain subsequent M3 work.

This slice edits `src/sim/reports/**`, the runner integration and tests, and the
headless health probe as needed. It does not edit renderer, browser, editor, or
scenario-template ownership. It does not add a public shared type: existing
`RenderSnapshot.reports`, `ReportStatus`, report event names, `false_report` and
`comms_outage` contracts are sufficient. Any later need for richer report
selection/inspector fields must be proposed in `docs/REQUESTS.md` and approved
before changing `src/contracts`.

## Alternatives considered

1. **Reports-first, then dispatch (recommended).** Implement uncertain reports
   and belief updates as a deterministic, tested subsystem, then consume verified
   reports in a separate M3B design. This isolates partial-information semantics
   and allows event/snapshot validation before response logic exists.
2. **Build the whole M3 dispatch loop at once.** This reaches a more complete demo
   sooner, but couples report generation, request lifecycle, resource allocation,
   hospital capacity, boats, aircraft, metrics, and failure recovery. It makes
   regressions difficult to localize and raises the risk of misleading metrics.
3. **Keep reports as event-only placeholders until dispatch is ready.** This
   avoids internal data structures but cannot demonstrate uncertainty or HQ
   knowledge and does not satisfy the M3 reports requirement.

## Data flow

1. The seeded population and sim clock identify a civilian distress episode (a
   civilian enters `SeekHelp` or `Stranded`). A report subsystem records at most
   one initial report per episode, with deterministic configured probability.
2. The reporter's true cell is perturbed with seeded RNG into a bounded position
   estimate. The report stores confidence, creation/delivery ticks, status, source
   and estimated cell internally. It never reads wall-clock time or live feeds.
3. Reports wait until their delivery tick. During a scheduled `comms_outage`,
   reports remain queued and deliver after connectivity returns. The existing
   `false_report` injection creates a false report at its specified tick; it
   cannot mutate the underlying civilian or true world state.
4. Delivery updates an HQ belief layer using only received report estimates and
   confidence, not truth. Duplicate reports are correlated/clustered for belief
   accumulation while their provenance remains visible in the event stream.
5. Reports progress through the existing `Unverified`, `Verified`, `Resolved`,
   or `False` statuses. Verification requires independent evidence available to
   the synthetic simulation; report count alone must not silently turn uncertain
   information into truth. False reports are excluded from future belief updates.
6. Each render snapshot contains owned `x`, `z`, `confidence`, and `status` typed
   arrays, preserving the existing contract. Deterministic report lifecycle
   events include a reason, estimated cell, confidence, and report identifier in
   the numeric event data where representable. HQ belief remains a sim-owned
   typed-array layer and is testable without adding it to the shared snapshot.

## Determinism and boundedness

- Use the run's seeded RNG only; never use `Math.random`, `Date.now`, or external
  data in `src/sim`.
- Report order, duplicate clustering, tie-breaking, and delivery order are stable.
- Bound live and retained report records by a documented deterministic limit
  derived from the scenario grid/population limits; overflow is explicit in an
  event/counter, never silent unbounded growth.
- Snapshot arrays are copies owned by the caller. Report lifecycle events are
  appended in tick and stable-ID order.

## Failure and safety behavior

- A report is information, not proof that a civilian exists at its estimated
  location. False reports never create rescue requests in M3A.
- A communication outage delays delivery but does not erase a queued report.
- No-route, delay, false, duplicate, and capacity-limit cases remain visible in
  event reasons and deterministic tests.
- This slice does not claim response time, unmet requests, fairness, rescue
  success, or dispatch effectiveness; those metrics remain unavailable until
  their producer is implemented.

## Acceptance tests

- Same scenario/seed yields byte-identical report arrays, HQ belief and event log.
- Distress reports have deterministic bounded position error, confidence and
  delivery delay; no report is delivered before its delay.
- A comms outage postpones delivery until the outage ends without dropping it.
- Injected false reports become `False` and do not create/verify a real distress
  record or update trusted belief.
- Duplicate reports preserve their individual provenance but do not multiply the
  HQ belief as independent certainty.
- Verification/resolution transitions are explicit, reasoned, and validated by
  existing `RenderSnapshotSchema` and `RunSummarySchema`.
- Empty population, report-cap exhaustion, tick-zero injection, and boundary
  cells remain safe and deterministic.
- `pnpm health`, `pnpm build`, deterministic multi-seed smoke, and a report-scale
  probe pass. Existing template and rescue-stress limitations remain disclosed.

## Approval record

User approved continuing with the staged report-first M3 approach on 2026-10-15.
This document is the detailed specification for review before implementation.
