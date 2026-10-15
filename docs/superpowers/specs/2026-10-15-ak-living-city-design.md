# AK living-city design — continuation of approved execution

Base: f058ff3; existing full SIM_SPEC/ROADMAP remain requirements. This is M1 core
work plus the hazard safety needed to keep moving agents valid when water arrives.
AJ owns browser integration. No dispatch/aircraft effectiveness is claimed here.

## Chosen approach

Keep agent attributes/state in typed arrays, routes as sparse per-agent plans, and
use the existing deterministic graph algorithms. Reuse target flow fields for
walking; construct walk/drive/walk routes for car owners. Per-tick A* for every NPC
was rejected for cost; moving every person along preset paths was rejected because
it would bypass hazard replanning. Tie-breaking and queue order stay deterministic.

## Contract amendments approved by AK

Optional Scenario.bridges defines absolute deck heights in metres; absent bridge
metadata defaults to ground+1m. Water stays measured over terrain; road safety on a
bridge uses deck overtopping. RunOptions adds startTimeSeconds and optional NpcParams.
Population customSchedule provides departAt (seconds of day) and workTicks; custom
without these fields rejects. Office/night runs default to 07:55/19:55, with 08:00/
20:00 departures, seeded +/-120s offsets and 8h work periods; later days repeat.
Optional event actorKind/targetKind disambiguates numeric ID namespaces. New live
events always include their actor kind; legacy M0 events remain parseable.

## Population and movement

Generate exact configured civilian counts and staff rosters. Seeded bounded
attributes implement global means. Allocate housing/workplaces by capacity with
explicit fallback for unassigned people; unassigned people stay put. Medical staff
target operational hospitals; other staff target role facilities. Civilian car
IDs follow emergency-fleet reserved IDs. Parked cars occupy parking space outside
the moving-lane model; failed cars block their road cells.

Agents commute from home via safe paths, work, and return. Cars travel only roads/
bridges; drivers walk between building entrances and road access. Foot paths use
walkable terrain and building entrances, not solid building interiors. Cell=4m;
walking base speed 1.4m/s times attributes, car speed 8m/s. Check every entered cell
even when a tick crosses several cells. Replan when a future edge closes, and emit
a reason. Flooded cars stall; no-route people wait/seek help and do not teleport.
Partial-information reports and evacuation utility decisions follow in M2/M3.

## Traffic

Per-cell throughput credits, automatic intersections, BPR cost factors and stable
rotating processing order. Powered intersections use full capacity, dark signals
half capacity, police-control hook 0.8 capacity. Queued cells accumulate wait ticks;
connected persistent waits produce GRIDLOCK once per episode. No wall-clock input.

## Evidence

TDD: schema boundaries; seeded population and capacity allocation; threshold/bridge
passability; walk-drive-walk round trips; closures and trapped agents; fair traffic
admission and blackout effects; owned snapshots/inspectors; deterministic logs;
actual movement invariants. Health/build/batch comparisons remain runnable. Record
stages and measurements in AK_STATUS/CHANGELOG; commit the verified source and docs.
No release readiness from schema-only mocks; W1/AJ dependencies remain explicit.
