# AK M3C Design: Boat Rescue Fallback

**Status:** Proposed for user review; no implementation is included in this document.
**Owner:** AK simulation lane.
**Depends on:** M3A uncertain reports and M3B ambulance/hospital dispatch on `codex/ak-m3-reports`.

## Goal and boundary

Add a deterministic, finite boat-rescue path for delivered report incidents that have no safe ambulance route. Boats transport rescued civilians to an appropriate safe destination, while reusing the existing report, incident, ambulance, shelter and hospital systems wherever possible.

This is the next incremental M3 response slice. It does not implement police, helicopters, the full simultaneous-failure stress scenario, the M4 critic loop, or browser integration. It makes no shared-contract changes and uses synthetic state only.

## Approaches considered

1. **Boat fallback for ambulance-inaccessible incidents (selected).** Keep the existing ambulance policy comparison unchanged. If no ambulance has a safe route to an active incident, dispatch an eligible boat with a safe water route. This avoids two vehicle types racing to and duplicating the same scene and limits changes to the dispatch policy.
2. **Mixed-mode policy competition.** Let boats and ambulances bid on every incident. This can select the lowest-ETA responder, but broadens the existing policy comparison and requires mode-specific feasibility/capability rules throughout assignment and re-queueing.
3. **Separate boat dispatch subsystem.** Implement an independent boat queue and lifecycle. This isolates code but risks duplicate incident ownership and inconsistent report completion.

Approach 1 was selected by the user on 2026-10-15. Rescued injured civilians are handed to an ambulance at shore; shelter and healthy-resident destinations follow the rules below.

## Existing behavior and shared boundaries

- Boat movement already has a `boat` hazard mode in `src/sim/nav/hazards.ts`: entered cells require at least 0.6m of water; bridge cells, trees, levees and buildings are impassable.
- The simulation has `scenario.fleet.boats` and `boatOperators`, `VehicleKind.Boat`, `VehicleState`, `boat_failure` injection, and deterministic vehicle ID ranges. No boat dispatch/movement/passenger lifecycle exists yet.
- M3B owns report-cluster incidents, field search, synthetic health/triage, ambulance movement and atomic hospital-bed reservations. M2 owns civilian movement and shelter capacity reservations.
- No new event or snapshot fields are planned. Existing vehicle snapshots and event types must carry boat movement and assignment evidence without leaking hidden truth before scene arrival.
- Preserve the AK simulator contract and its adapter boundary. Do not change the frozen shared contracts without separate approval.

## Proposed architecture

### Fleet and water routes

- Create a fixed finite boat table in `src/sim/dispatch/boats.ts`. The number of operational boats is `min(scenario.fleet.boats, scenario.fleet.boatOperators)`; each active boat has one operator and four passenger places. These are deterministic simulation rules, not clinical or field-capacity claims.
- Allocate IDs from the existing reserved fleet ordering, after ambulance and police-car ranges and before helicopter and civilian-car ranges. Never collide with ambulance, car, or future police/heli IDs.
- A boat launches from a deterministic safe water access adjacent to a `BoatDepot`; if no valid launch exists, it is unavailable, not teleported onto water. It travels only on cells allowed by the existing boat hazard grid. It cannot cross a bridge in the current 2.5D representation.
- Route planning selects a navigable water cell that can serve the report’s bounded uncertainty footprint. Routes are deterministic, re-planned when hazards change, and any lost assignment remains queued. No fuel/refuelling model is added in this slice; that gap remains explicit for a later vehicle-resource slice.

### Dispatch fallback and incident ownership

- Keep the current ambulance dispatch policies and their eligibility unchanged. For an active, undiscovered incident, try safe ambulance candidates first. Only when no safe ambulance route exists may a safe boat route become eligible.
- A single incident owner prevents an ambulance and boat from independently searching the same incident. If the assigned boat fails or loses every safe route, cancel the assignment with a reason and re-queue the incident; do not drop it.
- Boat arrival performs the existing bounded report-footprint search exactly once. Only a responder at the scene may inspect civilian distress, health, mobility, or home exposure. Reports with no confirmed distress are marked false using the existing report lifecycle.
- A boat loads at most four passengers per trip. If more people need rescue, the same incident remains active and the finite fleet makes additional trips; passenger and incident ownership prevent duplicate pickups.

### Civilian triage and destinations

Classification occurs at the scene, after field evidence is available:

1. **Injured:** synthetic health is below 100. Record the existing health-derived triage severity and carry the patient to a safe, dry, road-accessible shoreline handoff. Once unloaded, enqueue the patient for the existing ambulance/hospital flow. Hospital selection, powered/flood-safe eligibility, bed reservation, diversion and admission remain owned by M3B. A boat does not choose or reserve a hospital bed.
2. **Uninjured and needing shelter:** the civilian has the `needsAssist` mobility class or their assigned home building is flooded (water exceeds its floor height at any footprint cell). Reserve one available shelter place atomically before boarding. Carry the civilian to a safe landing from which the existing civilian route can reach that shelter; preserve/reuse the reservation and evacuation state rather than reserving twice.
3. **Other uninjured civilians:** carry them to a deterministic safe shoreline landing connected by a safe foot route toward their non-flooded home. They resume the existing civilian route from there. A civilian without a safe home/route is not silently marked served; it remains queued for a safe destination.

Safe shore/landing cells must be dry, non-building land cells adjacent to navigable water and connected to the required ambulance road or civilian foot route. Selection uses shortest safe route, then stable cell/building ID tie-breaks. If the needed handoff or destination is unavailable, do not load the civilian; retain the rescue/shelter request and retry safely.

### Tick order, events and metrics

- Integrate boat transitions at deterministic runner tick boundaries after hazards/closures are applied and before per-tick metrics/snapshots are projected.
- Emit existing event types (`ASSIGNED`, `REROUTE`, `COMMIT_CANCELLED`, `NPC_STATE`, `EVAC_ORDER`, `SERVED`, and `INJECTED` as appropriate) with typed actor/target IDs, precise reasons, and no pre-arrival truth disclosure. Add no contract event enum values.
- Reuse current response, unmet, utilization and shelter/hospital metrics. Boat-specific metrics are deferred because the frozen metrics contract has no boat-rescue field; do not mislabel helicopter metrics.
- Preserve determinism: seeded RNG only; stable unit/passenger order; no `Math.random`, wall clock, or renderer dependencies in `src/sim`.

## Safety and recovery invariants

- A boat enters water only at or above its 0.6m draft threshold and never enters a bridge, building, tree or levee cell.
- No boat or passenger is double-assigned; passenger count never exceeds four per boat; no civilian silently disappears between scene, boat, shore, ambulance, shelter or home.
- Shelter capacity is reserved once and released on diversion/failure; no shelter overflow is caused by rescue allocation.
- Injured patients enter the existing powered, flood-safe hospital bed reservation path after shore handoff. Existing M3B no-bed behavior remains visible/retryable.
- A failed/unroutable boat returns its incident and uncompleted passengers to an explicit safe queue/state. It never strands a passenger aboard an unavailable unit without a recovery path.
- Same scenario, seed and dispatch mode produce identical events, snapshots and metrics.

## Acceptance tests

- Fleet size is finite, bounded by available operators, uses non-colliding IDs, respects four-place capacity, and makes boats without safe depot launch cells unavailable.
- A boat cannot be dispatched without a safe navigable route; route steps obey the draft/obstacle/bridge rules and deterministically re-plan as water changes.
- A boat is only used after no safe ambulance candidate exists; a reachable ambulance continues to own the incident. Boat failure and route loss cancel/re-queue without losing incident or passengers.
- Scene search does not expose true civilian state before arrival, runs once per incident, and retains report provenance. False reports close without creating passengers.
- Injured passengers are triaged at scene, handed off at a safe shore, and use the existing ambulance hospital-balancing/bed-reservation path.
- `needsAssist` and flooded-home uninjured residents receive one atomic shelter reservation and reach an accessible landing; other uninjured residents use a safe home-connected landing. Full/unavailable destinations retain demand without dropping people.
- Capacity-limited multiple trips, simultaneous arrivals, duplicate reports, diversions, shelter overflow, boat failure, report resolution and same-seed replay have regression coverage.
- `pnpm health`, `pnpm build`, scenario validation, and deterministic multi-seed boat/ambulance comparison pass. Validation remains schema-only unless all release gates are independently met.

## Explicitly deferred

Police dispatch/traffic control; helicopters, rooftop rescue and medevac; boat fuel/refuelling; cross-mode fastest-ETA competition; a new boat metric/contract; full five-failure stress run; renderer/worker integration; M4 critic patch verification; M5/M6 demo hardening.
