# SIM_SPEC

Everything here is the **intended behaviour**. Build the numbered milestone in `docs/ROADMAP.md` first, then extend.

## 1. Blocks

| Block | Notes |
|---|---|
| `grass`, `dirt`, `sand`, `rock` | Terrain. Sand and grass soak water slowly; rock does not. Height is editable. |
| `road` | Auto-connects. Has lanes=1 or 2. Intersections auto-detected. |
| `bridge` | Road over water or low terrain. Stays passable unless the water surface reaches deck height. |
| `house`, `apartment`, `office`, `shop` | Population homes/workplaces. Capacity defines residents or workers. |
| `hospital` | Beds, ED capacity, staff roster, helipad flag, generator. |
| `police_station` | Police units, patrol cars. |
| `flood_hq` | Command centre. Holds HQ belief map, dispatcher. Exactly one is the active HQ. |
| `boat_depot` | Stores boats and boat operators. Needs adjacency to road or water. |
| `fire_station` (optional) | Extra rescue units. |
| `shelter` | Evacuation capacity. Schools and halls count. Raised floors help. |
| `drainage` | Removes water at `drainRate` while below its own capacity. Can clog (debris) in storms. Stormwater inlets sit on roads. |
| `tree` | Slightly slows water, adds visual cover. Can fall in high wind and block a road (optional). |
| `water_source` | River or lake cell. Level driven by weather/river model. |
| `power_plant`, `substation`, `pole` | Power graph. Poles follow roads. |
| `helipad` | Landing site for helicopters. |
| `levee` / `sandbag` | Raises the flood barrier. A cheap fix the critic can propose. |

## 2. People and vehicles

### Roles
`civilian`, `driver` (civilian in a car), `police`, `boat_operator`, `paramedic`, `doctor`, `nurse`, `hospital_staff`, `pilot`, `dispatcher`.

### Attributes (each rolled per NPC from distributions around global sliders)
| Attribute | Range | Effect |
|---|---|---|
| `speed` | 0.6–1.4× | walking pace |
| `risk_tolerance` | 0–1 | willingness to wade through water or ignore warnings |
| `compliance` | 0–1 | follows evacuation or police directions |
| `panic` | 0–1 | rises with water depth nearby and crowd density, lowers decision quality, adds crowd pressure |
| `altruism` | 0–1 | chance to help others (carry, wait, redirect) |
| `awareness` | 0–1 | how fast they notice hazards and warnings |
| `mobility` | `normal / limited / needs_assist` | speed, needs rescue earlier |
| `has_car` | bool | changes routing mode |
| `health` | 0–100 | drops with exposure and injuries |
| `fatigue` (staff/rescuers) | 0–1 | shift length, reduces effectiveness |

### Global sliders (UI → `NpcParams`)
Population density · % with cars · mean panic · mean compliance · warning delay · rescuer count (police, boats, ambulances, helicopters) · staff fatigue rate · false-report rate · communication delay. Sliders **shift the distribution means**. Per-NPC randomness remains, with seeded noise.

### Behaviour model
Utility-based decision loop with a small state machine per role:

- Civilian: `AtHome → Commute → Work → ReturnHome`, interrupted by `Warned → Evacuate | Shelter-in-place | Seek-help | Stranded`.
- Police: `Patrol → Respond → TrafficControl | CrowdControl | Escort`.
- Boat operator: `Idle → Mobilise (go to depot) → Rescue → DropAtShelter/Hospital → Refuel/Rest`.
- Medical staff: shift roster, report to the nearest working hospital, go home or stay depending on flooding and duty.

Utility example for a civilian deciding to evacuate:
`U = a·perceivedThreat + b·officialInstruction·compliance + c·neighbourEvacuating − d·travelRisk·(1−riskTolerance) − e·attachment`
Choose the max-utility action, with a seeded noise term. Log the top two utilities in the event reason.

### Vehicles
`car`, `bus` (optional evacuation), `ambulance`, `police_car`, `boat`, `helicopter`. Each has depth limit, speed, capacity and `fuel`.

| Vehicle | Max depth (voxels) | Notes |
|---|---|---|
| car | 0.3 | stalls above the limit and becomes an obstacle |
| ambulance / police car | 0.5 | |
| foot | 0.5 (unsafe above 0.3; speed penalty) | |
| boat | min depth 0.6 | cannot enter shallow cells, so it needs flooded streets |

## 3. Flood simulation

Voxel-based **virtual-pipe shallow-water cellular automaton** on the heightmap. It's 2.5D: the water surface is `ground + water`, rendered as stacked blocks.

Per tick, per cell:
1. Add rain: `water += rainRate(t) · permeabilityFactor`. Add source cells (river level, flash-burst).
2. For each of the 4 neighbours, compute the outflow from the head difference:
   `flow_dir = max(0, flow_dir + k·(surface_here − surface_neighbour))`
3. Scale outflows so a cell can't give more than it holds. Apply the net flow.
4. Buildings are obstacles. Water doesn't enter unless depth > door/foundation height, then water seeps in (interior flood flag for hospitals, substations).
5. Drainage: `water -= min(water, drainRate)` for drainage cells. A clogged drain has reduced rate.
6. Soak/evaporation: tiny constant, terrain-dependent.

Properties we need to see: **pooling in low terrain, water following roads and channels, bridges getting overtopped, drainage placement making a visible difference, flash floods arriving as a wave.** Stability: clamp the flow and use a CFL-safe `k`. Test with a mass-conservation unit test (total water ± sources − sinks).

Optional upgrade if time: velocity-dependent force (people swept away above a depth × speed threshold).

## 4. Weather and scenarios

- `rainTimeline`: piecewise-linear intensity over time, plus `wind`.
- Flood types: **growing** (long rain, rising river), **flash** (burst of water at a source cell or upslope band), **compound** (both).
- Warnings: HQ may issue a warning at a delay. Compliance determines reaction.
- **Injected events** (for the PS stress test): `bridge_closed`, `boat_failure`, `shelter_overflow`, `substation_flooded`, `road_blocked_by_debris`, `false_report`, `comms_outage`, `helicopter_grounded_wind`.

## 5. Traffic and flow

- Roads have capacity; vehicles queue at intersections. Traffic lights are on while powered. **Unpowered signals become 4-way stop** (capacity ×0.5).
- Police can be assigned `TrafficControl` at an intersection, which restores capacity (×0.8) and clears gridlock.
- Congestion feeds edge costs (BPR). Evacuation routes use flow fields to shelters.
- **Contraflow** (optional stretch): HQ can reverse a lane on an evacuation road.
- **Gridlock detection**: if a connected set of cells has speed ≈ 0 for T ticks, emit `GRIDLOCK`, which is the critic's key evidence.

## 6. Dispatch and negotiation

Two modes, selectable at run start (same scenario and seed, so the comparison is fair):

### A. Centralised baseline
HQ sees ground truth (or the HQ belief map, selectable), and solves assignment each N ticks: min-cost matching of units to requests with priority weights. Simple, strong when information is perfect, brittle with stale information.

### B. Decentralised negotiation (contract-net)
1. A request (incident report) is announced to units in radio range.
2. Each unit computes a **bid** from its own belief: `ETA`, capability fit, current load, fuel, risk.
3. Awarded to the best bid. The unit **commits**. A commitment can be **cancelled** with a reason (route closed, unit failed, higher-priority request) and the request is re-announced.
4. Anti-thrash: a re-assignment cooldown and a bid bonus for a unit already near.

Priority score for a request: `urgency (health, depth, vulnerable people) + waiting time + fairness boost`.
**Fairness**: a neighbourhood's `unmetShare` raises the priority of its requests, so response isn't concentrated on one district. Metric: Gini of time-to-service across districts.

### Hospital balancing (both modes)
For a patient at location `p`, hospital `h` gets:
`score(h) = travelTime(p,h) + λ·queueDelay(h) + μ·overloadPenalty(h) + ν·riskOfRouteClosure + ∞·(no capacity or no power and no generator or inaccessible)`
`queueDelay` comes from current ED load ÷ throughput. `overloadPenalty` rises sharply above ~85% utilisation. Ambulances re-evaluate en route and may **divert**, and a diversion emits an event with the old and new scores. Hospitals under internal flood or power loss go into `diversion` and stop accepting. Civilians who self-transport use a noisy version of the same score (they can't see queue depth and just pick the nearest).

### Shelter assignment
Same pattern: capacity, distance, access route safety. Overflow triggers a `shelter_overflow` event and re-routes to the next shelter.

## 7. Power grid

- Graph: `power_plant → substation → pole/line → buildings`. Power state is propagated by BFS from live sources each tick (when topology or flood state changes).
- A substation or plant cell with depth > threshold trips, and downstream nodes go dark.
- Effects: signals off, street lights off (cosmetic), hospital runs on a **generator with fuel timer** (e.g. 36 sim-hours scaled), shelters lose services, pumps (drainage) with `needsPower` stop.
- Critic evidence: "substation S2 in a low cell tripped at t=1840, which cut power to hospital H1 and 2 pumps."

## 8. Helicopters

- Based at helipads (hospital or air base). Capacity 4–8, range, fuel, **wind limit** (grounded above it).
- Tasks: **rooftop rescue** (isolated civilians flagged `stranded`), **medevac** (critical patient between hospitals), **supply drop** (optional).
- Use the same bidding or matching as boats, with `air` graph routing. Fast, but with few seats, so priority goes to cases no ground unit can reach.
- Emit events for each lift: `HELI_DISPATCH`, `HELI_PICKUP`, `HELI_GROUNDED`.

## 9. Reports and uncertainty

Civilians in distress produce **reports** (call-for-help) with: position error, a delay, a confidence, and a chance of being duplicate or false. HQ clusters near-duplicate reports (same idea as PS 02, so keep it simple). A report is `unverified → verified → resolved | false`. The UI shows uncertainty rings on unverified reports.

## 10. Metrics (`MetricsFrame`)

Required by the PS, plus ours:
- time-to-service (mean, p50, p90) per request class and per district
- unmet requests (count, % at end)
- resource idle time per unit type
- route violations (should be 0, so it doubles as a safety check)
- fairness: Gini across districts, worst-district time-to-service
- recovery time after an injected contradictory update
- hospital utilisation over time (peak, std-dev across hospitals; balance score)
- evacuation completion % over time, stranded count, casualties (simulated, abstract)
- gridlock minutes, mean network speed
- power: % of population unpowered, hospitals on generator
- water: flooded area, max depth, flooded road-km

## 11. Invariants (tests)

See `AGENTS.md` §7. Each is a pure function `(prevState, state) → Violation[]` called every tick in test mode, and sampled in prod.

## 12. Scenario templates (Worker 1 builds these)

1. `riverside-town` (small, teaching example): one river, 2 hospitals, 1 bridge.
2. `coastal-grid` (flash flood plus bad drainage): flat, storm-surge style.
3. `dense-basin-city` (large, compound): bowl-shaped, a power-critical substation, 3 hospitals, helipads.
4. `stress-triple` (PS stress test): bridge closure + boat failure + shelter overflow at the same time.

## 13. Proposed Laya decision-policy extension (2026-10-15)

Implementation status and phase gates are in [LAYA_MIGRATION_PLAN.md](LAYA_MIGRATION_PLAN.md); the current runtime has no Laya policy.

- Keep deterministic role state machines, A*/flow fields, flood/power solvers, traffic rules, and resource accounting. Laya may select from feasible high-level actions; it does not compute movement or certify safety.
- Start with a shortlist of at most five feasible hospitals and a defer/escalate option. Reject hospitals without capacity, a safe route, or active grid/generator power before shortlisting; recheck and reserve at commit time. If all candidates disappear, replan or re-queue rather than route to an invalid destination.
- Observe through agent beliefs, with report age/confidence and missing information explicit. Do not silently give decentralised agents HQ truth.
- Preserve two dispatch modes. Rules, shadow, and assisted decision policies are a separate experimental dimension; neither dispatch mode is renamed or removed.
- Keep pedestrian decisions above a real footpath/crossing graph. Enforce physically valid spawns, entrance access, crossing permissions, and vehicle queues in the simulator, independently of the selected policy.
- Use event-triggered inference with cooldowns and budgets. Hazards, hard operating limits, route invalidation, and reservation conflicts trigger immediate deterministic safety handling.
- Log the proposal, feasible alternatives, probability evidence, safety rechecks, chosen action/fallback, and reason. Do not present policy scores as probabilities or imply that explanations reveal a model's private reasoning.
- Record a versioned decision tape for assisted runs. Replay reads it without inference; stale or duplicate responses never commit. All existing §11 safety invariants remain mandatory.
- Evaluate rules and assisted policies with held-out synthetic scenarios and paired seeds. Publish regressions as well as improvements; a visually plausible run is not validation of decision quality.
