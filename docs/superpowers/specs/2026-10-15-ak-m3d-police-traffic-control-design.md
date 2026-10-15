# AK M3D Design: Independent Police Traffic Control

**Status:** Approved design, awaiting user review of this written spec; implementation has not started.
**Owner:** AK simulation lane.
**Depends on:** deterministic living-city traffic and the M3A-M3C simulation on `codex/ak-m3-reports`.

## Goal and boundary

Add an independent, finite police response that restores order at sustained gridlock intersections. Police cars travel from safe police-station access points, control an assigned intersection on arrival, and become available again when the gridlock clears. Police dispatch is not part of incident rescue dispatch and does not take work from ambulances, boats, or other rescue units.

This slice implements traffic control only. It does not implement civilian escort, crowd control, law-enforcement encounters, police investigation, or helicopter response. It uses synthetic simulation state, existing contracts, current event types, and existing vehicle snapshots; no shared contract changes are in scope.

## Approaches considered

1. **Independent finite police traffic-control subsystem (selected).** Maintain police vehicles and assignments separately from rescue dispatch. Detect eligible gridlocked intersections, route idle units there, and pass an arrived-unit control mask into the existing traffic-capacity hook. This preserves role separation and makes unit contention explicit.
2. **General shared responder dispatch.** Extend ambulance incident bidding to police and other vehicle types. This is unnecessary for traffic restoration and couples police to rescue task ownership and policy comparison.
3. **Static police-control mask.** Mark intersections as controlled without moving a finite police fleet. This is small but cannot model station access, travel delay, or police-car contention.

The user selected the independent police role and confirmed this slice is gridlock control only.

## Existing behavior and boundaries

- `scenario.fleet.policeCars` and `policeOfficers` are already validated inputs. Population generation creates police-role staff, but no operational police-car dispatch exists in the AK runner.
- `src/sim/traffic/index.ts` already accepts an optional binary `policeControlled` mask. At dark intersections the existing capacity rule is 0.5 without police and 0.8 with police; powered intersections retain capacity 1.0. `TrafficState` tracks sustained gridlock and emits existing gridlock events.
- `stepAgents` currently begins traffic processing without a police mask. The runner owns traffic and vehicle snapshots, making it the integration point for a separate police fleet.
- Vehicle ID ranges reserve ambulance IDs first, then police cars, then boats, helicopters, and civilian cars. Police IDs must stay in the reserved police range.
- Existing road hazard grids, deterministic pathfinding, movement assertions, `ASSIGNED`, `REROUTE`, and `COMMIT_CANCELLED` events are sufficient. No new event, metrics, snapshot, or injected-event contract is needed.

## Proposed architecture

### Finite police fleet

- Operational police units are bounded by `min(scenario.fleet.policeCars, scenario.fleet.policeOfficers)`. Each dispatched police car represents one staffed unit; excess cars or officers do not create unbounded responders.
- Allocate stable vehicle IDs from the police range immediately after ambulance IDs and before boat IDs.
- Initialize each unit at a deterministic safe road access cell adjacent to an operational police station. If no safe station access exists, that unit is unavailable rather than teleported onto a road.
- Keep police unit state, target intersection, and route separate from ambulance and boat assignments. Police assignment never changes incident ownership, casualty state, hospital allocation, or rescue-policy candidates.

### Gridlock dispatch and traffic-control lifecycle

- Dispatch only to a road cell that is an intersection and is marked gridlocked by the existing traffic state after the existing sustained-queue threshold. This keeps police work tied to observed traffic conditions rather than hidden future demand.
- Enumerate reachable candidates using the current police-car-safe road graph. Assign idle units and unowned eligible intersections deterministically: prioritize greater sustained wait, then higher queued demand, then stable cell index; choose the available unit by safe ETA and stable vehicle ID.
- Police cars move one safe route step per simulated tick and re-plan when navigation hazards change. Entered cells pass the existing movement assertions. Unreachable targets remain unassigned and are retried when the road graph changes or a future tick offers a route.
- A unit controls an intersection only after it arrives. Its presence contributes exactly one bit to the per-tick `policeControlled` mask. The existing traffic hook then supplies the 0.8 dark-intersection throughput; police do not reduce powered-intersection capacity.
- Release control and the target assignment when the intersection is no longer gridlocked. The unit remains at its current safe cell and becomes available for a later target; it need not return to station before redeployment.
- If a route becomes unsafe before arrival, emit a reasoned cancellation, clear the unit/target ownership, and retry through the ordinary candidate selection. A unit that cannot proceed is never treated as controlling the target.

### Tick order, events, and snapshots

- Keep traffic policy independent from rescue policies. Police dispatch and movement execute deterministically at runner tick boundaries using the prior completed traffic state; only arrived police units affect the next `beginTrafficTick` call.
- Extend the internal agent/runner boundary narrowly to supply the control mask to `beginTrafficTick`; preserve current civilian and civilian-car movement behavior when the mask is empty.
- Emit existing assignment, reroute, and cancellation event types with police vehicle actor IDs, intersection cells, and explicit reasons. Do not expose private or future state.
- Include police vehicles in the existing copied `RenderSnapshot.vehicles` arrays with `VehicleKind.PoliceCar`. Do not add contract fields or police-specific metrics; existing gridlock metrics and events remain the evidence for traffic recovery.

## Safety, determinism, and recovery invariants

- No more operational units than the smaller of configured police cars and officers; one unit owns at most one target and one target at most one unit.
- Police spawn and movement use safe road-access cells and existing vehicle depth/closure checks; there is no teleport on blocked or flooded roads.
- Police control is active only when an assigned police unit is physically at its target intersection and that target remains gridlocked.
- Police dispatch is independent from ambulance negotiation/centralized policies and cannot claim rescue incidents or civilian casualties.
- A route loss clears assignment state and leaves the intersection eligible for deterministic retry.
- Same scenario, seed, and dispatch mode produce identical police assignments, events, vehicle snapshots, and traffic metrics.

## Acceptance tests

- Zero cars, zero officers, and mismatched fleet counts produce the correct finite operational count; IDs do not collide with ambulance, boat, helicopter, or civilian vehicles.
- A unit launches only from safe police-station road access; no valid station access means unavailable.
- Uncongested cells and non-intersections are not assigned. Sustained gridlock dispatches a reachable unit, while stable priority and tie-break rules are repeatable.
- A unit affects traffic only after arrival. At an uncontrolled dark intersection capacity remains 0.5; police control raises it to 0.8; powered intersection capacity remains 1.0.
- Cleared gridlock releases the target for later work. Flooding, closure, or route loss cancels without leaving a stale control mask or losing the target permanently.
- Police and ambulance/boat assignments remain independent; police do not change incident ownership, dispatch policy comparisons, civilian rescue state, or hospital reservations.
- Snapshots contain owned/copied police vehicle arrays, events identify police actors correctly, and same-seed replay is identical.
- `pnpm health`, `pnpm build`, scenario validation, and deterministic traffic/load smoke runs pass. Scenario validation remains schema-only unless its separate release gates pass.

## Explicitly deferred

Civilian escort, crowd control, police-specific fuel/failure injections, police analytics fields, additional contract or event types, helicopter rescue/medevac, full compound-stress acceptance, renderer-specific changes, and demo/release approval.
