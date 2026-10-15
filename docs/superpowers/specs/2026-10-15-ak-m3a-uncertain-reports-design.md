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

1. On a civilian's transition into a continuous distress episode (`SeekHelp` or
   `Stranded`), awareness determines whether they call for help. Repeated ticks in
   the same episode do not create repeated reports. Leaving distress ends the
   episode. Each civilian may create at most one distress report per run.
2. The reporter's true cell is perturbed with seeded RNG. Maximum error radius is
   `ceil((1-awareness)*4)` grid cells, with coordinates clamped to the map;
   confidence is derived from awareness and bounded to [0,1]. The report stores
   creation/delivery ticks, status, source and estimated cell internally. It never
   reads wall-clock time or live feeds.
3. `NpcParams.falseReportRate` is the per-civilian probability of one anonymous
   false alarm per run. Its tick and estimated cell are sampled from a
   report-specific RNG stream; the stream is derived from the run seed and cannot
   perturb population, traffic, or other simulation randomness. Reports wait
   until their delivery tick using `NpcParams.commsDelay`. During a
   scheduled `comms_outage`, reports remain queued and deliver after connectivity
   returns. The existing `false_report` injection creates an unverified synthetic
   sighting at its specified tick; the HQ does not receive its hidden ground-truth
   label and it cannot mutate the true world or civilian state.
4. Delivery updates a confidence-weighted HQ belief layer using only received
   estimates. Reports near the same cell/time are clustered: provenance remains
   distinct, but one cluster contributes at most the maximum member confidence
   during its correlation window, preventing duplicates from multiplying belief.
5. M3A publishes new reports as `Unverified`. Independent corroboration may raise
   cluster confidence but does not itself reveal truth or mark a report `Verified`.
   `Verified`, `Resolved`, and `False` transitions require field evidence and are
   deferred to M3B dispatch; injected false reports must remain unverified until
   then. The internal truth label is available only to simulation tests, never HQ
   belief, snapshots, or decision logic.
6. Each render snapshot contains owned `x`, `z`, `confidence`, and `status` typed
   arrays, preserving the existing contract. Deterministic report lifecycle
   events include a reason, estimated cell, confidence, and report identifier in
   the numeric event data where representable. HQ belief remains a sim-owned
   typed-array layer and is testable without adding it to the shared snapshot.

## Determinism and boundedness

- Use a report-specific seeded RNG stream derived from the run seed; never use
  `Math.random`, `Date.now`, or external data in `src/sim`. Adding reports must
  not shift population or traffic RNG sequences.
- Report order, duplicate clustering, tie-breaking, and delivery order are stable.
- Allocate capacity for at most two stochastic reports per civilian (one distress
  report plus one false alarm) and every scheduled `false_report` injection. The
  run duration is at most one simulated day; generation quotas make capacity
  exhaustion impossible for a schema-valid run. Assert this bound in tests.
- Snapshot arrays are copies owned by the caller. Report lifecycle events are
  appended in tick and stable-ID order.

## Failure and safety behavior

- A report is information, not proof that a civilian exists at its estimated
  location. No report creates a rescue request in M3A.
- A communication outage delays delivery but does not erase a queued report.
- Delay, false and duplicate cases remain visible in event reasons and
  deterministic tests. Capacity is computed from validated maximum report counts;
  an internal assertion guards any violation of that bound.
- This slice does not claim response time, unmet requests, fairness, rescue
  success, or dispatch effectiveness; those metrics remain unavailable until
  their producer is implemented.

## Acceptance tests

- Same scenario/seed yields byte-identical report arrays, HQ belief and event log.
- Distress reports have deterministic bounded position error, confidence and
  delivery delay; no report is delivered before its delay.
- Awareness controls distress call likelihood and position error; falseReportRate
  controls one false-alarm probability per civilian per run; commsDelay
  controls delivery time. Each slider has deterministic boundary tests.
- A comms outage postpones delivery until the outage ends without dropping it.
- Injected false sightings remain `Unverified` from HQ's perspective, carry no
  hidden-truth signal into HQ belief, and do not create/verify a distress record.
- Duplicate reports preserve their individual provenance but do not multiply the
  HQ belief as independent certainty.
- Reports and lifecycle events validate against existing `RenderSnapshotSchema`
  and `RunSummarySchema`; later M3B field evidence owns verification/resolution.
- Empty population, maximum population, tick-zero injection, and boundary cells
  remain safe and deterministic; created record count never exceeds its derived
  preallocation bound.
- `pnpm health`, `pnpm build`, deterministic multi-seed smoke, and a report-scale
  probe pass. Existing template and rescue-stress limitations remain disclosed.

## Approval record

User approved continuing with the staged report-first M3 approach on 2026-10-15.
This document is the detailed specification for review before implementation.
