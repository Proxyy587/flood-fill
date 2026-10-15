# AK M3E/M3F Design: Police Escort and Crowd Control

**Status:** Direction approved by AK; written spec is awaiting user review. No implementation has started.
**Owner:** AK simulation lane.
**Depends on:** M2 civilian evacuation and M3D independent finite police traffic control on `codex/ak-m3-reports`.

## Goal and boundary

Extend the independent police system in two ordered slices: M3E civilian escort, then M3F crowd control. Police remain an independent public-order service, separate from ambulance, boat, hospital, and rescue assignment. Police guidance helps residents reach destinations already chosen by civilian evacuation/rescue logic; it does not take ownership of those choices.

Police units remain finite and officer-staffed (`min(policeCars, policeOfficers)`). Both slices use synthetic simulation state, seeded deterministic rules, current road/water safety checks, existing contracts and event types. No shared contract or renderer changes are planned.

## Approaches considered

1. **Independent finite police guidance (selected).** Add escort and crowd-control tasks to the existing police subsystem. Cars rendezvous on safe road cells, provide local guidance to civilians, and return to the common police task pool when work ends. Civilian routes and destinations remain owned by evacuation and rescue systems.
2. **Police take over civilian routing.** Directly assign or rewrite a civilian's destination/route. This is simpler to force, but risks conflicting with shelter reservations, hospital triage, safe-shore selection, and existing evacuation policy.
3. **Police transport civilians.** Use police cars as evacuation vehicles. This changes police into another rescue/transport fleet and requires passenger capacity, boarding, destination handoff, and additional safety invariants; it is outside this work.

The user selected the independent-guidance approach. Implement and verify M3E before beginning M3F; M3F then composes with the same finite police task system.

## Existing behavior and constraints

- M3D provides deterministic staffed police cars, safe police-station road deployment, car-safe navigation, a single assignment per unit, cancellation/retry, snapshots and traffic-control masks.
- M2 civilians already have safe route plans, shelter reservations, and states for evacuation, distress and stranding. Boat rescue can hand civilians to the same shelter/home routing. M3B/M3C own patient triage, hospital allocation, and rescued-person handoffs.
- Civilians have seeded compliance, panic and mobility values. `stepAgents` evaluates evacuation utility and follows per-person routes. No dynamic per-cell civilian crowd-density or foot-traffic capacity measure is implemented yet; crowd pressure must be added internally for M3F.
- Road-going police cars cannot enter unsafe roads. Police do not alter ambulance/boat ownership, casualty state, patient triage, bed reservations, or shelter capacity.

## M3E: civilian escort

### Eligibility and destination ownership

- Escort civilians who already have an active safe destination and route, prioritizing residents leaving threatened/flooded homes and civilians with limited mobility or needs-assist status.
- A civilian with an active medical/rescue assignment, aboard status, or no safe destination is not converted into an escort task. Existing ambulance/boat rescue and hospital/shelter handoff remain authoritative.
- Escort never creates a new destination, changes a shelter/home/safe-shore assignment, transfers a passenger, or bypasses a capacity reservation.
- Match nearby civilians into an escort group only when they are progressing toward the same existing destination and their safe routes share the next segment. A group remains a set of independent civilians; none is forced to join it.

### Police guidance lifecycle

- An available staffed police car selects an eligible group deterministically, prioritizing assistance need, current threat, and time waiting, then stable civilian ID/vehicle ID tie-breaks.
- The car routes to the nearest safe road-side rendezvous point for the group's current route. Once present, local police guidance reinforces compliance and encourages the group to stay on their already-safe shared route. Police guidance is a behavior modifier, not physical transport or an override of the route planner.
- As the group advances, the rendezvous/escort point can move along safe road access cells. If the group splits, reaches destination, becomes a rescue patient, loses a safe route, or the police route becomes unsafe, dissolve or re-evaluate the escort and make the unit available or reassign it deterministically.
- When current and alternate safe routes are unavailable, the police unit holds/cancels safely; it never moves civilians or itself through a blocked/flooded cell.
- Emit assignment, reroute, cancellation, and arrival evidence using existing event types and clear reasons. Do not add a new event enum or NPC/vehicle shared fields.

## M3F: crowd control

### Detection and target area

- Detect crowd pressure at evacuation chokepoints and shelter approaches only. Count civilian occupancy/approach demand with deterministic cell and route-segment aggregation; use a named, internally documented threshold with persistence so one transient tick does not trigger a dispatch.
- The detection scope is local and bounded: inspect candidate chokepoints and shelter approaches, not every possible cell pair. No real-world population data or live feeds are used.
- Rank active crowd targets by unsafe crowd pressure and nearby flood/threat exposure, then stable cell index. The implementation must document how the chosen threshold relates to the 4 m by 4 m cell footprint and cover it with tests at small and large population sizes.

### Guidance and safeguards

- A police car travels to a safe road-side control point near the crowd target. Guidance biases civilian movement toward safe alternate foot routes that preserve each person's existing destination; it does not relocate people, create capacity, or issue a shelter/hospital assignment.
- Route alternatives must pass the current foot hazard grid and the destination's existing reachability/capacity checks. Flooded/closed cells and unavailable shelters are never made eligible by police presence.
- Police presence does not add shelter beds, overbook a shelter, change hospital power/capacity, or mark a route safe if the navigation system rejects it.
- Release crowd control when pressure remains below the clear threshold for a deterministic dwell period, the target is no longer a chokepoint/shelter approach, or no safe work remains. Hysteresis prevents rapid dispatch/release oscillation.

## Shared finite-fleet arbitration

- Gridlock control (M3D), escort (M3E), and crowd control (M3F) are tasks for the same finite police units; police work remains separate from rescue dispatch.
- Use deterministic tiers: urgent unsafe crowd pressure first, high-need civilian escort next, and ordinary sustained gridlock after those. Within a tier use measured urgency and stable cell/person/unit IDs.
- Keep active assignments stable. Preempt only when a newly observed critical crowd hazard crosses a documented higher-priority threshold; otherwise let an assigned task finish or cancel for the existing safety/recovery reasons. A preempted gridlock remains eligible for retry. Assignment records must not oscillate between equal-priority targets.
- Recompute eligibility from current observed state at tick boundaries; the system adapts as threat, crowd pressure, safe routes, and civilian needs change. It must not use hidden future scenario truth.

## Safety, determinism and non-goals

- No police vehicle moves outside car-safe cells; no civilian is guided through a foot-unsafe edge.
- Unit/task ownership stays one-to-one. Unavailable, failed-route, and released work is not silently dropped.
- Escort and crowd guidance cannot alter rescue ownership, field triage, injury severity, hospital choice/bed reservations, shelter capacity, safe-shore/home destination, or report truth.
- Same scenario and seed produce identical police task assignments, guidance effects, events, movement and metrics.
- No new contract fields/events, renderer/UI, police transport, arrests/investigations, crowd-control force, direct destination reassignment, ambulance escort, helicopters, or new real-world data sources.

## Acceptance evidence

- M3E tests cover eligibility, same-destination grouping without forced joining, assistance/threat priority and deterministic ties, safe rendezvous, guidance only after police arrival, civilians retaining destinations/reservations, group split/completion, and route-loss release/retry.
- M3F tests cover bounded crowd detection, threshold and dwell/hysteresis, prioritization at chokepoints/shelter approaches, safe alternate-route guidance, destination/capacity invariants, critical escalation, stable release/retry and repeatability.
- Shared-fleet tests prove finite staffing, no duplicate task ownership, deterministic priority across crowd/escort/gridlock, critical-only preemption, and re-queue of preempted/failed gridlock work.
- Runner tests prove police tasks leave ambulance/boat/hospital state unchanged and snapshots/events remain copied and correctly attributed.
- Run focused suites, full `pnpm health`, production build, scenario validation, and deterministic multi-seed simulation checks. Report schema-only validation as such; this design does not imply release readiness or policy superiority.

## Self-review

- Scope preserves the user's requested order (escort, then crowd control) and the already implemented M3D independent police behavior.
- Injury and destination ownership remain with M3B/M3C rescue and the existing civilian routing systems; the plan does not turn police into transport.
- The crowd-density threshold, critical-preemption threshold, and exact route-influence formula are explicitly implementation details that must be documented, tested, and reviewed against the 4 m cell scale before code work begins.
- No contract change is proposed. If implementation proves one is necessary, stop and request AK/AJ approval before changing `src/contracts`.

