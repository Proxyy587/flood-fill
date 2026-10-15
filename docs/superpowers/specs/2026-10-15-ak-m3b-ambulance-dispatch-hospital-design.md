# M3B Design: Ambulance Dispatch and Hospital Balancing

## Goal and boundary

Build the next AK vertical slice after M3A: dispatch a finite ambulance fleet to
uncertain report incidents, verify the scene with field evidence, triage synthetic
flood-exposure injuries, transport patients, and reserve beds at operational
hospitals. Compare decentralized negotiation with a centralized baseline on the
same deterministic scenarios and seeds. The response adapts as incidents worsen
or cluster: additional casualties require additional units, severe demand raises
local hot-zone priority, and idle ambulances stage nearer to the current hot zone.

This slice covers ambulances and hospitals only. Boats and police are later
incremental response slices; helicopters and medevac remain later still. It does
not add real maps, medical advice, live feeds, casualty prediction, or spontaneous
unit creation. Results are synthetic simulation output, not an emergency-planning
authority.

## Approaches considered

1. **Report-to-hospital vertical slice (recommended).** Delivered report clusters
   create provisional incidents. Ambulances bid/are allocated to those incidents,
   verify reports at the scene, discover casualty count, and transport patients to
   reserved beds. Both policies are evaluated with the same seeds. This satisfies
   partial information and makes hospital balancing measurable in one coherent
   demo path.
2. **Truth-driven centralized response.** The dispatcher reads all distressed
   civilians and their severity before assigning units. This is simpler, but leaks
   hidden state, skips field verification, and cannot fairly demonstrate
   decentralized negotiation against a partial-information baseline.
3. **Scene response without transport.** Units only verify reports and assist at
   the scene. This isolates dispatch, but defers the explicitly prioritized
   hospital-balancing objective and cannot measure bed reservations/utilization.

Approach 1 is selected.

## Existing contracts and compatibility

No shared-contract change is planned. The frozen surface already contains:

- `RequestId`, `VehicleKind.Ambulance`, `VehicleState` and `ReportStatus`;
- `REQUEST_CREATED`, `BID`, `ASSIGNED`, `COMMIT_CANCELLED`, `SERVED`,
  `REPORT_VERIFIED`, `REPORT_FALSE`, `HOSPITAL_ASSIGN`, `HOSPITAL_DIVERT`,
  `REROUTE` and related event types;
- report and vehicle snapshot arrays, hospital utilization, TTS, unmet, Gini and
  idle-fraction metric fields.

Requests, patient links, bed reservations and hotspot state remain pure internal
simulation state. Report and request identities are referenced through existing
event fields. Ambulances use the existing vehicle snapshot shape. If implementation
proves these fields insufficient, record the need in `docs/REQUESTS.md` and pause
for approval before changing `src/contracts`.

## Internal architecture

- `src/sim/dispatch/incidents.ts` owns stable incident IDs and request lifecycle.
- `src/sim/dispatch/ambulances.ts` owns dedicated ambulance state, safe routes,
  assignment/replanning and one-patient transport capacity per unit.
- `src/sim/dispatch/negotiation.ts` and `centralised.ts` implement separate
  assignment policies over the same request/unit eligibility and route-cost
  functions.
- `src/sim/dispatch/hospitals.ts` owns synthetic injury exposure, field triage,
  operational-hospital eligibility and atomic bed reservations/admissions.
- `src/sim/dispatch/hotspots.ts` calculates deterministic demand zones and safe
  staging destinations for idle units.
- The runner applies reports and hazards at tick boundaries, steps existing agents,
  then performs incident updates, dispatch, emergency movement, arrival evidence,
  patient transport, bed transitions, invariants and metrics in a stable order.

All modules remain pure TypeScript under `src/sim`; use seeded state only, typed
arrays for entity tables, and explicit event reasons. Dispatch state does not read
`ReportSystem.isFalse`, `trueCell`, `sourceNpc`, or civilian health before scene
arrival. Those fields are hidden truth, not HQ information.

## Incident lifecycle and field evidence

1. Each newly delivered report enters an active correlation cluster using M3A's
   same/adjacent-cell, 30-second rule. The first report creates one provisional
   incident/request; later reports in the active cluster append provenance and
   update its estimate/confidence without creating duplicate requests. After the
   correlation window closes, a later report may create a new incident.
2. An unverified report is actionable: the first response is dispatched to its
   estimated location. Reports alone do not reveal a casualty, request severity or
   hidden report truth.
3. The first ambulance reaching the incident conducts a deterministic local
   search over each report's existing uncertainty footprint, bounded by
   `ceil((1-confidence)*4)` Manhattan cells around that estimate. Only this arrival
   step may inspect local civilian states and synthetic health. Every civilian
   found in distress becomes an incident casualty; each receives a separate
   ambulance assignment and hospital bed reservation. Additional available units
   are requested automatically for uncovered casualties.
4. A report whose search footprint contains field-confirmed distress becomes
   `Verified`; an unmatched report becomes `False`. If no casualty is found, the
   incident closes as a false alarm and its assigned ambulance is released. If
   casualties are found, the incident remains active until all are admitted or
   explicitly remain unmet; associated verified reports become `Resolved` only
   after their incident's patients are admitted.
5. If multiple responses arrive together, stable ambulance ID order performs
   scene discovery once. The incident owns the discovered casualty list and
   allocation flags, preventing two units from taking the same patient. Casualties
   beyond the available fleet remain queued and visible as unmet demand; they are
   never silently dropped.

## Synthetic injury and triage model

Injuries are abstract simulation variables, not clinical categories. A civilian's
existing `health` begins at 100. While the civilian is in `SeekHelp` or `Stranded`
and local water depth is above 0.3m, each one-second tick reduces health by
`0.25 + 0.5 * (depth - 0.3)` points, clamped to [0,100]. Outside those conditions,
this exposure injury does not progress. It is deterministic and depends on actual
environmental exposure, not the citizen's report or the dispatch policy.

At scene arrival, triage reads current health:

- minor: health > 75;
- moderate: 50 < health <= 75;
- severe: health <= 50.

The dispatcher learns these values only when field evidence is available. This
model deliberately does not claim medically valid thresholds. Health and triage
continue to update during exposure; once a casualty is loaded, flood exposure stops.

## Dispatch and adaptive hot zones

- Ambulances are created only from `scenario.fleet.ambulances`, with stable
  non-colliding vehicle IDs and a fixed start at the nearest safe hospital
  entrance, preferring powered hospitals. Since hospital building cells are not
  car-traversable, the operational entrance is represented in the road graph by
  its nearest safe adjacent road access cell. If no hospital entrance is safe, use
  the nearest safe road cell to Flood HQ; if there is no HQ, use the lowest-index
  safe road cell. If the map has no safe road cell, the unit stays unavailable
  and demand is counted unmet. Units are not spawned when demand exceeds supply.
- Negotiation mode: each available ambulance computes feasible bids for pending
  incidents from safe road ETA and current assignment state. Incidents rank by
  uncovered casualties first, then severity evidence available at scene, age and
  stable request ID. Bid acceptance is deterministic and commits one incident/unit
  pair at a time; no unit or casualty may be double-allocated.
- Centralized mode: the coordinator computes the same safe ETA/candidate set and
  greedily selects the best feasible unit/incident pairs by incident priority,
  ETA, ambulance ID and request ID. It cannot inspect unseen scene truth or severity.
- Both modes replan on flood/closure changes, enforce the existing vehicle depth
  and adjacency invariants, and preserve an unsafe active edge until a safe
  replan point. Failed/unreachable assignments release or requeue the unit and
  incident with a reasoned event.
- Hot zones use fixed 8x8-cell map regions. Score is `2 * uncovered severe
  casualties + severe casualties discovered and already admitted in the previous
  120 ticks`; scores decay as the rolling window advances. Pending severe
  casualties therefore get immediate weight, while repeated severe incidents keep
  their region prioritized without double-counting active patients.
  Request ordering uses the zone score after uncovered-casualty count. Idle
  ambulances stage at the operational hospital entrance with the lowest safe route
  ETA to the highest-scoring zone; active assignments are not abandoned for staging.
  If there are no severe casualties, idle units remain at their current safe
  operational hospital.
- Hot-zone priority can redistribute only the configured finite fleet. It changes
  which available ambulance is assigned/staged; it cannot manufacture vehicles or
  bypass unsafe roads, power, beds or assignment invariants.

## Hospital selection and bed lifecycle

A hospital is eligible only when it is reachable by a safe ambulance route, has a
positive remaining bed count after occupied and in-transit reservations, is not
diverting, has grid or active generator power, and is not flooded above its floor.
Admission capacity comes from the existing `BuildingDef.capacity` field.

The dispatcher reserves exactly one bed atomically before patient transport starts.
Severe patients choose the eligible hospital with minimum route ETA. For minor and
moderate patients, compute `score = routeETASeconds + 60 * (1 - severityScore) *
projectedUtilization`, where `severityScore` is 1 for severe and 0 for minor, with
moderate linearly interpolated from health 75 to 50. Choose the lowest score, then
hospital ID. This lets a farther, less-loaded hospital win for lower-severity cases
when the travel-time difference is outweighed by bed pressure; severe cases favor
speed. Full/unpowered/flooded hospitals are never eligible.

If a reserved hospital loses power, floods, diverts, or loses safe access en route,
release its reservation, emit a reasoned diversion/reroute event, and retry another
eligible hospital. If no hospital can safely accept the patient, keep the patient
with the incident/assigned ambulance, retain unmet status, and retry each tick; do
not admit into zero capacity or drop the patient. On arrival, convert the reserved
bed to occupied and release the ambulance for its next assignment. Hospital
utilization includes occupied plus in-transit reservations divided by capacity.

## Metrics, invariants and verification

- TTS records time from first delivered report in an incident to first ambulance
  scene arrival, summarized as mean/p50/p90 over incidents that have had a scene
  arrival. The incident log retains the report-to-bed time separately in its
  `SERVED` event. Unmet counts active provisional incidents plus confirmed
  casualties not yet admitted; confirmed patients are counted once, not again as
  an incident. Gini is calculated over district mean report-to-bed delays for
  incidents with confirmed patients; map each estimated incident cell to the
  lowest-ID containing district, or an `unassigned` bucket if none contains it.
  Still-unadmitted casualties are censored at the current tick. Empty/single-demand-
  district runs return zero. Idle fraction is
  measured for the ambulance fleet. Hospital utilization includes reservations as
  described above.
- Enforce no double assignment of a unit or casualty; no duplicate bed reservation;
  no admission without a reservation; no unsafe vehicle cell; no patient silently
  removed from an incident; and no policy access to hidden truth before field arrival.
- Tests cover false report closure, report-cluster deduplication/provenance,
  report delay/outage, field verification with bounded uncertainty, multiple
  casualties and units, severity worsening, severe-vs-minor hospital choices,
  bed contention/power/flood diversions, hotspot scoring/staging, deterministic
  same-seed runs, same-seed mode comparisons and both frozen Zod schemas.
- Scale probes cover 10,000 civilians, report/incident preallocation bounds and the
  configured ambulance count; `pnpm health`, `pnpm build`, `pnpm sim:batch`,
  `pnpm sim:compare`, headless multi-seed checks and `git diff --check` are required.
  Results remain synthetic evidence, not policy recommendations or release approval.

## Known text cleanup in this slice

Update the runner's `RUN_STARTED` capability data/reason and the living-city docs:
M3A reports are implemented, while dispatch and aircraft are not yet complete. Do
not label all reports unavailable or describe the current stage as only evacuation.

## Approval record

On 2026-10-15 the user approved ambulance-first M3B, one provisional request per
report cluster, on-scene verification/triage, severity-aware hospital balancing,
multiple casualties per incident, and finite-fleet adaptive hot-zone staging. Boats,
police and helicopters are later slices. No shared-contract change is approved or
needed by this design.
