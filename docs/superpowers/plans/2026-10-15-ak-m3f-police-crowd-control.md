# AK M3F Police Crowd-Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic finite police crowd control at evacuation chokepoints and shelter approaches, guiding pedestrians through safe alternatives without changing destinations or shelter capacity.

**Architecture:** Build on the typed finite police-task arbitration delivered by M3E. A bounded crowd subsystem counts current pedestrian occupancy and next-cell approach demand only at validated chokepoints/shelter approaches, applies threshold persistence and hysteresis, then submits deterministic high-risk control candidates to the shared police fleet. An arrived unit supplies an internal guidance-cost field to `stepAgents`; existing goal and reservation ownership remain unchanged.

**Tech Stack:** Strict TypeScript, Vitest, typed-array crowd counts/masks, existing `AgentRoute`, `PoliceSystem`, foot hazard grids, deterministic pathfinding and existing SimEvent types.

---

## Dependency and file map

This plan starts only after `docs/superpowers/plans/2026-10-15-ak-m3e-police-escort.md` passes and its tests/documentation are complete.

- Create `src/sim/dispatch/police-crowd.ts`: candidate topology, bounded occupancy/approach aggregation, deterministic activation/clear persistence, severity ranking and safe control-point selection.
- Create `src/sim/dispatch/police-crowd.test.ts`: density threshold, bounded scanning, persistence/hysteresis, deterministic ordering, threat scaling, route-safety and 10,000-NPC coverage.
- Modify `src/sim/dispatch/police.ts` and `src/sim/dispatch/police.test.ts`: add `CrowdControl` task kind, target persistence, shared-fleet tier arbitration and critical-only preemption/requeue while preserving escort and gridlock behavior.
- Modify `src/sim/agents/system.ts` and `src/sim/agents/system.test.ts`: accept an internal police crowd-guidance cost overlay; when a route is impacted, replan only at a safe node through the existing destination and reservation.
- Modify `src/sim/runner.ts` and `src/sim/runner.test.ts`: derive crowd candidates at the tick boundary, pass arrival-only guidance into `stepAgents`, emit existing police assignment/reroute/cancel events, prove rescue/hospital isolation and deterministic snapshots.
- Modify `docs/CHANGELOG.md`, `docs/AK_STATUS.md`, and `docs/ROADMAP.md`: report the verified M3F slice, exact checks, and remaining non-police work.

Do not modify `src/contracts/**`, `src/render/**`, `app/**`, scenario schemas, hospital/shelter capacities, rescue dispatch ownership, or the M3E group eligibility rules.

In `police-crowd.test.ts`, import `BlockType`, `NpcState`, `livingFixture`, `createWorld`, `createPopulation`, `createAgentSystem`, `createCrowdControl`, and `measureCrowdPressure`; import `AgentSystem` and `PopulationState` as types. Define these fixtures once:

```ts
function crowdFixture(count = 5) {
  const scenario = livingFixture();
  scenario.population.count = count;
  scenario.blocks[46] = BlockType.Grass;
  scenario.blocks[10] = BlockType.Shelter;
  const shelter = scenario.buildings.find((building) => building.type === BlockType.Shelter)!;
  shelter.cells = [10];
  shelter.entrance = 10;
  const world = createWorld(scenario);
  const population = createPopulation(scenario, 42);
  const agents = createAgentSystem(population, world, scenario);
  const crowd = createCrowdControl(world, scenario);
  return { scenario, world, population, agents, crowd };
}

function activateEvacuationRoute(agents: AgentSystem, population: PopulationState, npc: number, cells: number[], goal: number) {
  const cursor = cells.indexOf(10);
  agents.intent[npc] = 3;
  agents.shelterAssignment[npc] = 0;
  population.npcs.state[npc] = NpcState.Evacuate;
  agents.routes.set(npc, { cells, modes: cells.map(() => 0), cursor, progress: 0, goal, version: npc + 1 });
  population.npcs.cell[npc] = cells[cursor - 1];
}
```

In `police-crowd.test.ts`, import `BlockType`, `NpcState`, `livingFixture`, `createWorld`, `createPopulation`, `createAgentSystem`, `createCrowdControl`, and `measureCrowdPressure` from the relevant existing/new modules; import `AgentSystem` and `PopulationState` as types. Define these fixtures once and use them for the unit tests:

```ts
function crowdFixture(count = 5) {
  const scenario = livingFixture();
  scenario.population.count = count;
  scenario.blocks[46] = BlockType.Grass;
  scenario.blocks[10] = BlockType.Shelter;
  const shelter = scenario.buildings.find((building) => building.type === BlockType.Shelter)!;
  shelter.cells = [10];
  shelter.entrance = 10;
  const world = createWorld(scenario);
  const population = createPopulation(scenario, 42);
  const agents = createAgentSystem(population, world, scenario);
  const crowd = createCrowdControl(world, scenario);
  return { scenario, world, population, agents, crowd };
}

function activateEvacuationRoute(agents: AgentSystem, population: PopulationState, npc: number, cells: number[], goal: number) {
  agents.intent[npc] = 3;
  agents.shelterAssignment[npc] = 0;
  population.npcs.state[npc] = NpcState.Evacuate;
  agents.routes.set(npc, { cells, modes: cells.map(() => 0), cursor: cells.indexOf(10), progress: 0, goal, version: npc + 1 });
  population.npcs.cell[npc] = cells[cells.indexOf(10) - 1];
}
```

## Task 1: Detect crowd pressure at bounded pedestrian targets

**Files:** create `src/sim/dispatch/police-crowd.ts`, create `src/sim/dispatch/police-crowd.test.ts`.

- [ ] **Step 1: Write red tests for target topology and occupancy.** Build a fixture from `livingFixture()` with one shelter, a one-cell-wide foot corridor, and civilian routes through the choke. Count each civilian once per target: current occupancy if `npcs.cell[npc] === target`, otherwise next-step approach if `route.cells[route.cursor] === target`. Only include civilian indices below `civilianCount` with active `Evacuate` or safe destination-return routes.

  ```ts
  it("counts current and approaching civilians once at a chokepoint", () => {
    const fixture = crowdFixture(5);
    activateEvacuationRoute(fixture.agents, fixture.population, 0, [9, 10], 10);
    activateEvacuationRoute(fixture.agents, fixture.population, 1, [8, 9, 10], 10);
    fixture.population.npcs.cell[0] = 10;
    fixture.population.npcs.cell[1] = 8;
    const pressure = measureCrowdPressure(fixture.agents, fixture.world, fixture.scenario);
    expect(pressure.peopleAtOrApproaching[10]).toBe(2);
  });
  ```

- [ ] **Step 2: Run the focused test and confirm the absent-module failure.** Run `pnpm exec vitest run src/sim/dispatch/police-crowd.test.ts`. Expected: FAIL because `police-crowd.ts` has not been created.
- [ ] **Step 3: Implement bounded target construction and one-pass measurement.** Export `CROWD_HOTSPOT_THRESHOLD = 4`, `CROWD_CLEAR_THRESHOLD = 2`, `CROWD_CRITICAL_THRESHOLD = 8`, `CROWD_HIGH_TICKS = 2`, and `CROWD_CLEAR_TICKS = 5`; document that one cell is 4 m × 4 m (16 m²), four occupants is 0.25 persons/m² and eight is 0.5 persons/m². Derive target cells from passable foot topology: shelter entrances/adjacent approach cells and passable corridor cells with at most two passable foot neighbors. Scan eligible civilians once, adding a civilian to a target count once when physically occupying it or when its next route cell is the target. Return typed arrays and sorted candidate cell indices; do not run a path search for every civilian-target pair.
- [ ] **Step 4: Add scale and boundary tests.** Cover exactly 3/4/8 occupants, non-civilians, `Respond`/aboard civilians, missing routes, flooded/blocked foot cells, map-edge neighbor counts, and 10,000 civilians with a linear one-pass iteration assertion. Run `pnpm exec vitest run src/sim/dispatch/police-crowd.test.ts`; expected: pass with no scan beyond candidate cells and active civilian route heads.
- [ ] **Step 5: Commit crowd measurement.** Stage only `police-crowd.ts` and its tests; commit as `feat(sim): measure deterministic crowd pressure`.

## Task 2: Add stable activation, hysteresis, severity and safe control points

**Files:** `src/sim/dispatch/police-crowd.ts`, `src/sim/dispatch/police-crowd.test.ts`.

- [ ] **Step 1: Add failing temporal and safety tests.** Require pressure at or above 4 for two consecutive ticks before requesting an ordinary crowd-control task; mark critical at 8 or more occupants plus a threatened/flood-exposed approach; clear only below 2 for five consecutive ticks. Equal pressure sorts by greater nearby water exposure, then lower cell index. Choose a police rendezvous only from reachable car-safe roads adjacent to the target.
- [ ] **Step 2: Run tests to observe the expected missing temporal-state behavior.** Run `pnpm exec vitest run src/sim/dispatch/police-crowd.test.ts`. Expected: threshold-persistence, hysteresis, priority and safe-rendezvous tests fail.
- [ ] **Step 3: Implement a bounded `CrowdControlSystem`.** Store per-candidate above/below-threshold tick counters and active target state in typed arrays allocated from the grid cell count. Export `createCrowdControl(world, scenario)`, `stepCrowdControl(system, agents, world, scenario, blocked, navVersion, tick)`, and `crowdControlSnapshot(system)`. Update only valid candidate cells; activate after two consecutive ticks at or above 4, retain control until five consecutive ticks below 2, classify critical only when pressure is at least 8 and current approach depth is at least 0.3 m, and select safe control points by shortest route then stable cell index. Candidate output includes `{ kind: PoliceTaskKind.CrowdControl, subject: -1, assignmentCell, targetCell, urgency, critical }`, where `assignmentCell` is the crowd hotspot and `targetCell` is the safe police-car control point. Rebuild candidate topology only when `navVersion` changes. Reuse current hazard grids; no hidden future state and no unbounded all-pairs `findPath` loop.
- [ ] **Step 4: Verify temporal replay.** Run `pnpm exec vitest run src/sim/dispatch/police-crowd.test.ts`; call the same fixture twice with the same cell counts and ticks and require identical candidates, counters and events.
- [ ] **Step 5: Commit stable target lifecycle.** Stage crowd-control source/tests only; commit as `feat(sim): add persistent crowd-control targets`.

## Task 3: Arbitrate crowd, escort and traffic jobs through finite police units

**Files:** `src/sim/dispatch/police.ts`, `src/sim/dispatch/police.test.ts`, `src/sim/dispatch/police-crowd.ts`, `src/sim/dispatch/police-crowd.test.ts`.

- [ ] **Step 1: Add failing cross-task arbitration tests.** With one staffed police unit and simultaneous candidates, choose critical crowd over escort and gridlock; choose high-need escort over ordinary gridlock when no critical crowd exists; preserve an active task across equal-priority ticks; preempt only an active task when a newly observed critical crowd target is at least 8 and threat-exposed. On preemption clear old ownership and leave old gridlock eligible for next dispatch tick.
- [ ] **Step 2: Run the focused police suites and confirm arbitration gaps.** Run `pnpm exec vitest run src/sim/dispatch/police.test.ts src/sim/dispatch/police-escort.test.ts src/sim/dispatch/police-crowd.test.ts`. Expected: new cross-task priority and preemption assertions fail before the shared selector is extended.
- [ ] **Step 3: Implement deterministic task tiers without fleet expansion.** Add `PoliceTaskKind.CrowdControl` and widen the M3E `PoliceTaskCandidate` union with `kind`, `subject`, `assignmentCell`, `targetCell`, `urgency`, and `critical`. Select currently eligible tasks in this order: critical unsafe crowd, high-need escort, ordinary crowd, sustained gridlock; within a tier use urgency descending, assignment cell ascending, subject ID ascending, vehicle ID ascending. Keep active assignments unless complete/canceled or a critical unsafe crowd candidate meets the preemption rule. Preemption emits `COMMIT_CANCELLED`, clears route/task ownership, and leaves the prior M3D target discoverable next tick. Never assign one unit or task twice; `min(policeCars, policeOfficers)` remains unchanged. Return `{ events, controlled, crowdGuidance }`, where `controlled` is M3D's arrived gridlock mask and `crowdGuidance` marks only crowd hotspots whose assigned unit is physically at the safe `targetCell`.
- [ ] **Step 4: Add multi-unit, retry and anti-oscillation tests.** Check two police cars own distinct tasks, no task is double-owned, ties replay byte-identically, non-critical crowd pressure cannot evict escort/gridlock, and a preempted gridlock resumes after crowd clear. Run all three police suites and verify every cancellation has a reason.
- [ ] **Step 5: Commit shared police arbitration.** Stage only police task code and tests; commit as `feat(sim): prioritize police crowd response safely`.

## Task 4: Guide pedestrians around controlled crowd hotspots without changing destination

**Files:** `src/sim/agents/system.ts`, `src/sim/agents/system.test.ts`, `src/sim/dispatch/police-crowd.ts`, its tests.

- [ ] **Step 1: Write failing route-preservation tests.** In `agents/system.test.ts`, extend its existing `setup()` wrapper to forward a third optional `crowdGuidance?: Uint8Array` argument to `stepAgents`. Add this complete fixture and use it in the test below:

  ```ts
  function setupEvacuationThroughChoke() {
    const scenario = town();
    const fixture = setup(scenario);
    const cells = [9, 10, 11, 19, 27, 35, 43, 44, 45, 46];
    fixture.a.intent[0] = 3;
    fixture.a.shelterAssignment[0] = 0;
    fixture.p.npcs.state[0] = NpcState.Evacuate;
    fixture.a.routes.set(0, { cells, modes: cells.map(() => 0), cursor: 1, progress: 0, goal: 46, version: 1, guidanceVersion: 0 });
    return { ...fixture, agents: fixture.a, step: fixture.step };
  }
  ```

  ```ts
  it("routes around police-guided crowd pressure while preserving shelter ownership", () => {
    const fixture = setupEvacuationThroughChoke();
    const shelter = fixture.agents.shelterAssignment[0];
    const guidance = new Uint8Array(64); guidance[10] = 1;
    const events = fixture.step(1, undefined, guidance);
    expect(fixture.agents.shelterAssignment[0]).toBe(shelter);
    expect(fixture.agents.routes.get(0)?.goal).toBe(46);
    expect(fixture.agents.routes.get(0)?.cells).not.toContain(10);
    expect(events.some((event) => event.type === "REROUTE" && /police crowd guidance/i.test(event.reason))).toBe(true);
  });
  ```

- [ ] **Step 2: Run the regression and confirm current routing ignores police guidance.** Run `pnpm exec vitest run src/sim/agents/system.test.ts -t "police-guided crowd pressure"`. Expected: FAIL because `stepAgents` accepts no guidance overlay.
- [ ] **Step 3: Add a validated internal guidance overlay and deterministic safe detour.** Extend `stepAgents` with optional trailing `crowdGuidance?: Uint8Array`, preserving the existing `policeControlled?: Uint8Array` position. Validate both masks are grid-sized and binary. Add `guidanceVersion` to `AgentSystem` and `AgentRoute`, and store the prior guidance mask in `AgentSystem`; increment the version only when the mask changes. Copy foot costs and multiply passable guided-cell costs by `CROWD_ROUTE_COST_FACTOR = 4`; never alter `passable`. If an active route intersects a guided cell and its saved guidance version is stale, mark it for rerouting only at a safe node (`route.progress === 0`); finish any partial edge first. Re-plan toward the same existing `goal`, preserve shelter assignment/intent and use current hazard checks for every entered cell. Save the current guidance version on a newly planned route, preventing repeated reroutes when no safe alternate exists.
- [ ] **Step 4: Verify all destination and capacity invariants.** Add regressions for police not opening blocked/flooded routes, no new or released bed reservations, no changed NPC goal, unchanged powered/traffic-capacity behavior, malformed-mask rejection, and exact same-seed routes/events. Run `pnpm exec vitest run src/sim/agents/system.test.ts src/sim/agents/evacuation.test.ts src/sim/dispatch/police-crowd.test.ts`.
- [ ] **Step 5: Commit agent route guidance.** Stage only agent system and tests plus the crowd guidance projection source/tests; commit as `feat(sim): route civilians around police-managed crowds`.

## Task 5: Integrate crowd dispatch and guidance at runner tick boundaries

**Files:** `src/sim/runner.ts`, `src/sim/runner.test.ts`, police crowd/arbitration tests.

- [ ] **Step 1: Add failing integration tests.** Create a small scenario with police station, shelter approach, a constricted foot corridor, evacuation warning and enough civilians to cross the crowd threshold. Step until crowd-control assignment and police arrival; assert the target is an approach/chokepoint, civilians keep destination/reservation, police `VehicleId` is correctly attributed, ambulance/boat events and hospital state are unchanged, and the resulting snapshot validates/owns its arrays.
- [ ] **Step 2: Run the integration regression and confirm runner omission.** Run `pnpm exec vitest run src/sim/runner.test.ts -t "police crowd control"`. Expected: FAIL because crowd candidates and guidance are not wired to runner ticks.
- [ ] **Step 3: Integrate in stable tick order.** After current flood/power/closure updates, call `stepCrowdControl` with observed `AgentSystem`, current world/blocked road mask, `navVersion` and next tick; combine its candidates with escort candidates and existing gridlock eligibility in the shared police dispatcher. Pass `policeStep.controlled` and `policeStep.crowdGuidance` to `stepAgents` as the two optional final mask arguments. Append police events once. Keep rescue and hospital processing in its existing later order. Copy all police vehicle snapshot arrays as M3D already does.
- [ ] **Step 4: Verify ordering and replay.** Run `pnpm exec vitest run src/sim/runner.test.ts src/sim/dispatch/police.test.ts src/sim/dispatch/police-escort.test.ts src/sim/dispatch/police-crowd.test.ts src/sim/agents/system.test.ts`. Run the integrated scenario twice with each of three fixed seeds; compare complete summaries and per-tick snapshots byte-identically. Assert crowd-control code leaves incident/boat/ambulance assignments, triage decisions, hospital reservations and shelter capacity unchanged at each police tick boundary; do not require equal downstream arrival times when safe civilian routes have changed.
- [ ] **Step 5: Commit runner integration.** Stage only runner and integration tests; commit as `feat(sim): integrate adaptive police crowd control`.

## Task 6: Document M3F and verify full simulation health

**Files:** `docs/CHANGELOG.md`, `docs/AK_STATUS.md`, `docs/ROADMAP.md`.

- [ ] **Step 1: Record the implemented scope.** State the exact crowd threshold, clearing hysteresis, critical-preemption rule, safe routing behavior and tests actually run. Retain helicopter rescue/medevac, compound stress, renderer integration and broader release gates as remaining work where applicable.
- [ ] **Step 2: Run full checks.** Run `pnpm health`, `pnpm build`, `pnpm validate`, and documented deterministic batch/compare runs for at least three fixed seeds, including a small crowded-shelter case and a 10,000-resident load case. Expected: lint, strict types, all tests, schema validation, production build and deterministic comparisons pass; explicitly label scenario validation schema-only.
- [ ] **Step 3: Commit M3F documentation and verification.** Stage only the three named documentation files; commit as `docs(sim): record M3F police crowd-control checkpoint`.

## M3F acceptance checklist

- Pressure detection is deterministic, bounded, thresholded, persistent and limited to evacuation chokepoints/shelter approaches.
- Critical crowd conditions outrank escort/gridlock only at the documented threshold; noncritical work stays stable; canceled work can retry.
- A police unit affects route choice only after safe arrival. Crowd guidance adds cost, never passability; every route remains foot-safe and keeps its original goal.
- Shelter/hospital capacity, destination ownership, field triage, rescue assignment, M3D traffic-control behavior, shared contracts and snapshots remain valid.
- Same scenario/seed replays identically; 10,000-resident measurement stays linear in civilian count plus bounded candidate cells.
