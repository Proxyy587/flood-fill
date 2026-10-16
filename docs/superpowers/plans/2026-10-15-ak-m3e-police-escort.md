# AK M3E Police Civilian Escort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add finite independent police-car escorts for eligible civilians while preserving each civilian's safe route, destination, rescue ownership, and shelter reservation.

**Architecture:** Extend the M3D police fleet with typed internal task ownership for gridlock and escort jobs. A new escort selector forms deterministic groups from already-routed evacuation/shore-handoff civilians with the same destination and next route segment, then sends one police car to a safe roadside waypoint alongside that existing route. Police cars accompany the group; they never carry civilians or write civilian routes.

**Tech Stack:** Strict TypeScript, Vitest, seeded deterministic simulator, existing `PoliceSystem`, `AgentSystem`, road/foot hazard grids, `findPath`, existing SimEvent types.

---

## File map

- Modify `src/sim/dispatch/police.ts`: add internal `PoliceTaskKind` and `taskSubject` arrays; accept escort candidates in `stepPolice`; preserve all M3D gridlock behavior, arrival-only traffic-control mask, route cancellation and police snapshots.
- Modify `src/sim/dispatch/police.test.ts`: prove M3D task ownership and gridlock regressions survive typed task state.
- Create `src/sim/dispatch/police-escort.ts`: own escort wait-time state, identify eligible routed civilian groups and compute their safe roadside escort waypoints.
- Create `src/sim/dispatch/police-escort.test.ts`: test eligibility, deterministic grouping/selection, safe waypoint calculation and regrouping after route changes.
- Modify `src/sim/agents/system.ts`: export the internal `AgentRoute` type and add an internal `rescueHandoff` marker so dispatch can distinguish a boat-handoff home route from ordinary commuting; dispatch reads these values without mutating them.
- Modify `src/sim/runner.ts` and `src/sim/runner.test.ts`: derive escort candidates at tick boundaries, step the shared police fleet, emit escort events, preserve snapshot ownership and rescue-state isolation.
- Modify `docs/CHANGELOG.md`, `docs/AK_STATUS.md`, and `docs/ROADMAP.md`: record M3E completion and retain M3F crowd control as the next police slice.

Do not modify `src/contracts/**`, `src/render/**`, `app/**`, civilian destinations, shelter reservations, triage/hospital logic, or boat/ambulance assignment policies.

In `police-escort.test.ts`, import `BlockType`, `NpcState`, `livingFixture`, `createWorld`, `createPopulation`, `createAgentSystem`, `createEscortSystem`, `createPolice`, `createTraffic`, and the types `AgentSystem` and `PopulationState` from their existing modules. Define the fixture helpers exactly as follows, then use them in the tests:

```ts
function escortFixture(count = 2) {
  const scenario = livingFixture();
  scenario.population.count = count;
  scenario.fleet.ambulances = 0;
  scenario.fleet.policeCars = 1;
  scenario.fleet.policeOfficers = 1;
  scenario.blocks[18] = BlockType.PoliceStation;
  scenario.buildings.find((building) => building.id === 3)!.type = BlockType.PoliceStation;
  for (const cell of [17, 19, 25, 26, 35]) scenario.blocks[cell] = BlockType.Road;
  const world = createWorld(scenario);
  const population = createPopulation(scenario, 42);
  const agents = createAgentSystem(population, world, scenario);
  const escort = createEscortSystem(population.civilianCount);
  const blocked = new Uint8Array(world.width * world.height);
  const police = createPolice(scenario, world, blocked);
  const traffic = createTraffic(world);
  return { scenario, world, population, agents, escort, blocked, police, traffic };
}

function activateEvacuationRoute(agents: AgentSystem, population: PopulationState, npc: number, cells: number[], goal: number) {
  agents.intent[npc] = 3;
  agents.shelterAssignment[npc] = 0;
  population.npcs.state[npc] = NpcState.Evacuate;
  const cursor = cells.indexOf(10);
  agents.routes.set(npc, { cells, modes: cells.map(() => 0), cursor, progress: 0, goal, version: npc + 1 });
  population.npcs.cell[npc] = cells[cursor - 1];
}
```

## Task 1: Represent traffic and escort as distinct police tasks

**Files:** `src/sim/dispatch/police.ts`, `src/sim/dispatch/police.test.ts`.

- [ ] **Step 1: Add a failing typed-task regression.** In the existing police test file, add `PoliceTaskKind` to the import from `./police` and add this assertion for the M3D-only case. Reuse the file's existing `trafficFixture()` helper:

  ```ts
  it("labels existing gridlock ownership as a traffic task", () => {
    const fixture = trafficFixture();
    fixture.traffic.intersections[27] = 1;
    fixture.traffic.gridlock[27] = 1;
    stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1);
    expect(fixture.police.assignment[0]).toBe(27);
    expect(fixture.police.taskKind[0]).toBe(PoliceTaskKind.TrafficControl);
    expect(fixture.police.taskSubject[0]).toBe(-1);
  });
  ```

- [ ] **Step 2: Run the focused test and confirm the missing-task-field failure.** Run `pnpm exec vitest run src/sim/dispatch/police.test.ts -t "labels existing gridlock ownership"`. Expected: FAIL because `taskKind` and `PoliceTaskKind` are not defined.
- [ ] **Step 3: Add typed ownership while preserving the M3D API.** In `police.ts`, export `enum PoliceTaskKind { None, TrafficControl, Escort }`; add `taskKind: Uint8Array` and `taskSubject: Int32Array` to `PoliceSystem`; initialize them to `None` and `-1`. Set traffic kind on assignment. Release a traffic task when its `assignmentCell` is no longer gridlocked; release an escort only when its group is no longer eligible. Clear task metadata in every release, cancellation, route-loss and unavailable path. Export `PoliceTaskCandidate = { kind: PoliceTaskKind.Escort; subject: number; assignmentCell: number; targetCell: number; urgency: number; critical: false }` and add an optional final `escortCandidates: readonly PoliceTaskCandidate[] = []` parameter to `stepPolice`.
- [ ] **Step 4: Verify M3D ownership and legacy behavior.** Run `pnpm exec vitest run src/sim/dispatch/police.test.ts`. Expected: all tests pass; traffic assignments still activate only after arrival, and every cleared unit has `taskKind === PoliceTaskKind.None`, `taskSubject === -1`, and `assignment === -1`.
- [ ] **Step 5: Commit the isolated task-state change.** Stage only `src/sim/dispatch/police.ts` and `src/sim/dispatch/police.test.ts`; commit as `refactor(sim): type police task ownership`.

## Task 2: Select eligible escort groups from read-only civilian routes

**Files:** `src/sim/agents/system.ts`, create `src/sim/dispatch/police-escort.ts`, create `src/sim/dispatch/police-escort.test.ts`.

- [ ] **Step 1: Add failing eligibility and grouping tests.** Use the explicit `escortFixture()` and `activateEvacuationRoute()` helpers in the fixture section above. A qualifying civilian must be in an active evacuation or marked safe boat-to-home handoff route, have a valid `AgentSystem.routes` entry, and not be a medical/rescue patient or aboard passenger. Group key is `(destination goal, next route cell)` plus current-cell proximity of at most two Manhattan cells; sort group members by NPC ID and use the lowest ID as the subject.

  ```ts
  it("groups only civilians with the same destination and next safe route segment", () => {
    const { agents, population, escort } = escortFixture(3);
    activateEvacuationRoute(agents, population, 0, [9, 10, 11, 19, 27, 35, 43, 44, 45, 46], 46);
    activateEvacuationRoute(agents, population, 1, [8, 9, 10, 11, 19, 27, 35, 43, 44, 45, 46], 46);
    activateEvacuationRoute(agents, population, 2, [8, 9, 10, 11, 19, 27, 35, 43, 44, 45, 46, 47], 47);
    const groups = stepEscortGroups(escort, agents, 0);
    expect(groups.map((group) => group.members)).toContainEqual([0, 1]);
    expect(groups.flatMap((group) => group.members)).not.toContain(2);
  });
  ```

- [ ] **Step 2: Run the new test and confirm it fails before implementation.** Run `pnpm exec vitest run src/sim/dispatch/police-escort.test.ts`. Expected: FAIL because `police-escort.ts` does not exist.
- [ ] **Step 3: Expose the route as read-only internal data and implement grouping.** Export `AgentRoute` from `agents/system.ts` with the current fields `cells`, `modes`, `cursor`, `progress`, `goal`, and `version`; change `AgentSystem.routes` to `Map<number, AgentRoute>` without changing route mutation behavior. Add `rescueHandoff: Uint8Array` to `AgentSystem`; set it only in `handoffRescuedCivilian`, clear it in `requeueFailedRescue` and on route arrival. Define `EscortGroup { subject: number; members: number[]; goal: number; nextCell: number; eligibleSince: number }` and `EscortSystem { eligibleSince: Int32Array }` initialized to -1; export `createEscortSystem(civilianCount)` and `stepEscortGroups(system, agents, tick)`. Include only civilians with `intent === 3` and `NpcState.Evacuate`, or `rescueHandoff[npc] === 1` and `NpcState.ReturnHome`; require `route.goal >= 0` and `route.cursor >= 1 && route.cursor < route.cells.length`. Exclude `NpcState.Respond` and every NPC index `>= civilianCount`. Key groups by `route.goal` and `route.cells[route.cursor]`, include only members whose current cells are within Manhattan distance two of the group's lowest-ID member, sort members/groups by stable NPC ID, and use `eligibleSince` for deterministic wait priority. Return data only; never mutate civilian route/destination/reservation state.
- [ ] **Step 4: Add coverage for ineligible residents and route completion.** Assert that `AtHome`, `Work`, `SeekHelp`, `Stranded`, `Respond`, completed routes, invalid route cursors and staff NPCs create no escort group. Run `pnpm exec vitest run src/sim/dispatch/police-escort.test.ts`; expected: all grouping tests pass deterministically.
- [ ] **Step 5: Commit route-read access and pure grouping.** Stage `src/sim/agents/system.ts`, `src/sim/dispatch/police-escort.ts`, and its test; commit as `feat(sim): select eligible civilian escort groups`.

## Task 3: Route police safely alongside escort groups

**Files:** `src/sim/dispatch/police-escort.ts`, its test, `src/sim/dispatch/police.ts`, its test.

- [ ] **Step 1: Add failing safe-waypoint and bounded-fleet tests.** For each group route cell, enumerate adjacent road/bridge cells in ascending cell index; reject cells that fail `canEnter(..., "car", ...)`. Select the reachable roadside cell with minimum police route length; break ties by cell index. Return no candidate when every roadside cell is unsafe/unreachable.

  ```ts
  it("selects a reachable safe roadside waypoint and ignores flooded access", () => {
    const fixture = escortFixture(1);
    activateEvacuationRoute(fixture.agents, fixture.population, 0, [9, 10, 11, 19, 27, 35, 43, 44, 45, 46], 46);
    fixture.scenario.blocks[19] = BlockType.Road;
    fixture.world.block[19] = BlockType.Road;
    fixture.world.water[19] = 0.31;
    const [group] = stepEscortGroups(fixture.escort, fixture.agents, 0);
    expect(escortWaypoint(group, fixture.world, fixture.scenario, fixture.blocked, fixture.police.cell[0])).toBe(17);
  });
  ```

- [ ] **Step 2: Run the waypoint test and confirm it fails before implementation.** Run `pnpm exec vitest run src/sim/dispatch/police-escort.test.ts -t "safe roadside waypoint"`. Expected: FAIL because `escortWaypoint` is absent.
- [ ] **Step 3: Implement deterministic escort candidate construction and task persistence.** Define each escort candidate with `kind`, `subject`, `assignmentCell`, `targetCell`, `urgency` and `critical: false`; for M3D gridlock set `assignmentCell === targetCell === intersection`, and for escort set `assignmentCell` to the group's current shared route cell and `targetCell` to its safe roadside waypoint. Add `escortWaypoint(group, world, scenario, blocked, policeCell): number | null` using `buildHazardGrid(..., "car", blocked)` and `findPath`; inspect only road/bridge cells adjacent to the group's current shared route segment. Build one candidate per group with `kind: PoliceTaskKind.Escort`, `subject` equal to its lowest-ID member index, and ordering keys `(needs-assist rank descending, nearby water threat descending, eligibleSince ascending, subject NPC ID ascending)`. Pass candidates to `stepPolice`; assign escort work to idle units before new ordinary gridlock work, preserve active assignments, use existing car-safe movement/nav-version rerouting, and retain one-to-one unit/group ownership. When an assigned car reaches its waypoint, emit one escort-arrival event and keep it associated until the group completes, splits beyond radius two, loses a safe route, or becomes ineligible. The police car advances to the next safe roadside waypoint as the route's shared next cell changes; civilians retain their exact route arrays and goals.
- [ ] **Step 4: Add lifecycle regressions.** Verify police guidance is inactive until car arrival; only the assigned group receives an escort association; split/completed/ineligible groups release cleanly; unsafe road closure emits `COMMIT_CANCELLED`, clears task fields and allows retry; `policeControlled` continues to contain only M3D gridlock targets. Run `pnpm exec vitest run src/sim/dispatch/police-escort.test.ts src/sim/dispatch/police.test.ts`.
- [ ] **Step 5: Commit safe escort routing.** Stage only police escort/task code and tests; commit as `feat(sim): route police alongside evacuation escorts`.

## Task 4: Integrate escort at runner tick boundaries without destination changes

**Files:** `src/sim/runner.ts`, `src/sim/runner.test.ts`, `src/sim/dispatch/police-escort.ts`.

- [ ] **Step 1: Add failing runner tests.** In `runner.test.ts`, start from its existing `policeStationScenario({ policeCars: 1, policeOfficers: 1 })`, set one civilian needing assistance and `weather.warningDelay = 0`, and use the fixture's existing flood source to trigger evacuation. Step until police assignment and arrival. Assert the police `ASSIGNED` event targets the civilian ID, exactly one `EVAC_ORDER` keeps the same shelter building target, an `ARRIVED` event shows the civilian's existing trip completed, and the police vehicle appears in an owned snapshot. Keep direct `shelterAssignment` preservation assertions in the unit suite where `AgentSystem` is available.

  ```ts
  expect(sim.summary().events).toContainEqual(expect.objectContaining({ type: "ASSIGNED", actorKind: "vehicle", targetKind: "npc" }));
  expect(sim.snapshot().vehicles.kind).toContain(VehicleKind.PoliceCar);
  expect(sim.summary().events.filter((event) => event.type === "SERVED" || event.type === "HOSPITAL_ASSIGN")).toHaveLength(0);
  ```

- [ ] **Step 2: Run the regression and confirm it fails for the absent runner path.** Run `pnpm exec vitest run src/sim/runner.test.ts -t "police escorts"`. Expected: FAIL because runner does not pass escort candidates or emit escort assignment events.
- [ ] **Step 3: Integrate at the existing state boundary.** Initialize `const escorts = createEscortSystem(population.civilianCount)` beside the police system. In `runner.ts`, after `updateClosures(tick + 1)` and before `stepAgents`, call `stepEscortGroups(escorts, agents, tick + 1)`, derive safe candidates using the current world/blocked mask/navVersion, and call `stepPolice(..., escortCandidates)`. Keep an active unit associated by `(taskKind, taskSubject)` while updating its route-side waypoint as the group's shared segment advances. Append returned events and preserve the current traffic control mask to `stepAgents`. Emit `ASSIGNED` with police vehicle actor and civilian leader target using existing event types. Do not modify `agents.intent`, `shelterAssignment`, route `goal`, incidents, patients, hospitals or boat ownership.
- [ ] **Step 4: Verify runner, snapshot, and deterministic replay.** Run `pnpm exec vitest run src/sim/runner.test.ts src/sim/dispatch/police-escort.test.ts src/sim/dispatch/police.test.ts`; run the same escorted simulation twice with the same seed and compare complete summaries and snapshots byte-identically.
- [ ] **Step 5: Commit runner integration.** Stage only runner and test changes; commit as `feat(sim): integrate police civilian escort`.

## Task 5: Record M3E status and verify before starting M3F

**Files:** `docs/CHANGELOG.md`, `docs/AK_STATUS.md`, `docs/ROADMAP.md`.

- [ ] **Step 1: Update status documents.** Record implemented behavior, tests actually run, and explicit remaining M3F crowd-control scope. Do not claim release readiness, real-world applicability or policy superiority.
- [ ] **Step 2: Run M3E focused and full checks.** Run `pnpm exec vitest run src/sim/dispatch/police.test.ts src/sim/dispatch/police-escort.test.ts src/sim/agents/system.test.ts src/sim/runner.test.ts`, `pnpm health`, and `pnpm build`. Run `pnpm sim:compare -- --seeds 0,42,77 --ticks 120 --scenario scenarios/riverside-town.json --out .cache/m3e-compare.json`; expected: each command exits 0, the comparison JSON records seeds 0, 42 and 77, and repeating it yields byte-identical summaries.
- [ ] **Step 3: Commit M3E documentation and verification record.** Stage only the three named docs; commit as `docs(sim): record M3E police escort checkpoint`.

## M3E acceptance checklist

- Police fleet remains bounded by staffed cars; police IDs/snapshots do not collide with rescue vehicles.
- Escort groups contain only eligible civilians sharing the same destination and next route segment; nonmembers are not joined or rerouted.
- Police vehicle follows safe road access alongside civilians, and escort becomes active only after arrival.
- Existing civilian route goal, shelter reservation, rescue state, triage, hospital destination, and boat/ambulance ownership remain unchanged.
- Route loss, group split, completion, and safety changes release/retry deterministically; M3D gridlock behavior still passes its focused suite.
- No contract files change. M3F crowd control starts only after M3E checkpoint passes.
