# AK M3D Police Traffic-Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add independent finite police-car dispatch to sustained gridlocked intersections, where an arrived unit restores the existing dark-signal traffic capacity without participating in rescue dispatch.

**Architecture:** Add a pure police dispatch subsystem for staffed fleet creation, safe station access, deterministic assignment, road movement, recovery, the arrived-unit control mask, and owned vehicle snapshots. The runner advances it before stepAgents; stepAgents forwards the mask to the existing traffic hook. Snapshots and events reuse existing contracts and types. No contract migration, rescue policy change, or UI work.

**Tech Stack:** TypeScript strict, seeded deterministic core, typed arrays, Vitest, current road hazard grid/pathfinding and movement invariants.

---

## File map

- Create src/sim/dispatch/police.ts: finite PoliceSystem, safe deployment, route planning, target assignment, movement, cancellation/retry, control-mask projection, and owned police vehicle snapshot.
- Create src/sim/dispatch/police.test.ts: focused unit tests for fleet boundaries, movement, target ownership, control activation, and recovery.
- Modify src/sim/agents/system.ts: add optional policeControlled grid argument to stepAgents and pass it to beginTrafficTick.
- Modify src/sim/agents/system.test.ts: prove an empty mask preserves current behavior and a supplied mask reaches traffic accounting.
- Modify src/sim/runner.ts and src/sim/runner.test.ts: initialize the police subsystem, step it at state boundaries, emit events, and merge copied police arrays into vehicle snapshots.
- Modify docs/CHANGELOG.md: record M3D implementation, verification, and retain M3E escort and M3F crowd control as follow-ons.

Do not modify src/contracts/**, src/render/**, app/**, ambulance/boat assignment policies, or civilian behavior in this slice.

## Task 1: Finite police fleet and safe road movement

**Files:** create src/sim/dispatch/police.ts and src/sim/dispatch/police.test.ts.

- [ ] **Step 1: Write fleet and deployment tests.** Define stationScenario() in police.test.ts from livingFixture(): change the existing Office at cell 18 (building id 3) to PoliceStation; keep road cell 17 and add road cells 19, 25, and 35 alongside the existing east-west road through row 3. This gives safe adjacent station access and makes cell 27 an intersection more than one step from the lowest-ID spawn road. For the no-access variant, change cells 17, 19, and 26 to Grass. Use this complete helper:

    type PoliceFixtureOptions = { ambulances?: number; policeCars?: number; policeOfficers?: number; safeStationRoad?: boolean };
    function stationScenario(options: PoliceFixtureOptions = {}): Scenario {
      const scenario = livingFixture();
      scenario.fleet.ambulances = options.ambulances ?? 1;
      scenario.fleet.policeCars = options.policeCars ?? 1;
      scenario.fleet.policeOfficers = options.policeOfficers ?? 1;
      scenario.blocks[18] = BlockType.PoliceStation;
      const station = scenario.buildings.find((building) => building.id === 3)!;
      station.type = BlockType.PoliceStation;
      for (const cell of [17, 19, 25, 26, 35]) scenario.blocks[cell] = BlockType.Road;
      if (options.safeStationRoad === false) {
        for (const cell of [17, 19, 26]) scenario.blocks[cell] = BlockType.Grass;
      }
      return scenario;
    }

    Import Scenario from ../../contracts/types and BlockType, VehicleKind, and VehicleState from ../../contracts/types. Import livingFixture from ../agents/living-fixture and createWorld from ../world/grid.

Test min(policeCars, policeOfficers), zero and mismatch counts, IDs in [ambulances + 1, ambulances + policeCars], and no ID overlap with the existing boat range.

    it("bounds staffed police cars and uses the reserved police ID range", () => {
      const scenario = stationScenario({ ambulances: 2, policeCars: 3, policeOfficers: 2 });
      const police = createPolice(scenario, createWorld(scenario), new Uint8Array(64));
      expect(police.count).toBe(2);
      expect(Array.from(police.id)).toEqual([3, 4]);
    });

    it("does not spawn a unit when police station has no safe adjacent road", () => {
      const scenario = stationScenario({ policeCars: 1, policeOfficers: 1, safeStationRoad: false });
      const police = createPolice(scenario, createWorld(scenario), new Uint8Array(64));
      expect(police.available[0]).toBe(0);
      expect(police.cell[0]).toBe(-1);
      expect(policeSnapshot(police).id).toHaveLength(0);
    });

- [ ] **Step 2: Run the focused tests and observe the expected missing-module failure.** Run pnpm exec vitest run src/sim/dispatch/police.test.ts; expected: import failure because the new module does not exist.
- [ ] **Step 3: Implement the finite state and safe launch.** Export createPolice(scenario, world, blocked), PoliceSystem, stepPolice(system, traffic, world, scenario, blocked, navVersion, tick), and policeSnapshot(system). Keep typed arrays for ID, availability, state, cell, transform, assignment, target, and route version; routes may use the existing route-object pattern used by src/sim/dispatch/ambulances.ts. Use count = min(policeCars, policeOfficers), reserve IDs immediately after ambulance IDs, and spawn only on safe road cells adjacent to a configured police station. Do not require or mutate the separate police-role NPC movement table.
- [ ] **Step 4: Add route and movement tests, then implement.** Test an adjacent one-cell move, no move onto a flooded/blocked road, deterministic replanning when navVersion changes, and movement assertions via assertMovementEntry. Route over buildHazardGrid(world, scenario, "car", blocked) and findPath; on route loss clear route/target ownership and emit a reasoned cancellation so the next tick may retry.
- [ ] **Step 5: Run the focused suite.** Run pnpm exec vitest run src/sim/dispatch/police.test.ts; expected: all fleet, spawn, route, and movement tests pass.

## Task 2: Deterministic gridlock assignment and control mask

**Files:** modify src/sim/dispatch/police.ts; extend src/sim/dispatch/police.test.ts.

- [ ] **Step 1: Write failing dispatch tests.** Construct a TrafficState with a gridlocked intersection and adjacent road cells. Prove that only unowned cells where both intersections[cell] and gridlock[cell] are set are eligible; target and unit ownership are one-to-one; non-gridlocked/non-intersection cells receive no assignment; and stable tie-breaking repeats exactly. Powered gridlocked intersections may receive an orderly police assignment, but remain at capacity 1.0. Cover release when the target stops being gridlocked and cancellation/retry when the route closes.

    Define trafficFixture() by calling stationScenario(), createWorld(scenario), createTraffic(world), and createPolice(scenario, world, blocked), where blocked is new Uint8Array(64). Return those five values. Define assignedTrafficFixture() by calling trafficFixture(), setting intersections[27] and gridlock[27] to 1, calling stepPolice once at tick 1, and returning the fixture.

    it("assigns an eligible gridlocked intersection once and activates control only on arrival", () => {
      const { scenario, world, blocked, traffic, police } = trafficFixture();
      traffic.intersections[27] = 1;
      traffic.gridlock[27] = 1;
      const result = stepPolice(police, traffic, world, scenario, blocked, 0, 1);
      expect(police.assignment[0]).toBe(27);
      expect(result.controlled[27]).toBe(0);
      const arrived = stepPolice(police, traffic, world, scenario, blocked, 0, 2);
      expect(arrived.controlled[27]).toBe(0);
      const atIntersection = stepPolice(police, traffic, world, scenario, blocked, 0, 3);
      expect(atIntersection.controlled[27]).toBe(1);
    });

    it("releases a cleared intersection and leaves its police unit available", () => {
      const fixture = assignedTrafficFixture();
      fixture.traffic.gridlock[27] = 0;
      stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 2);
      expect(fixture.police.assignment[0]).toBe(-1);
    });

- [ ] **Step 2: Run the focused tests and observe failure.** Run pnpm exec vitest run src/sim/dispatch/police.test.ts; expected: new assignment/control assertions fail before dispatch logic exists.
- [ ] **Step 3: Implement stable dispatch.** Define stepPolice(system, traffic, world, scenario, blocked, navVersion, tick) to release targets no longer gridlocked, then order candidate intersections by descending waited, descending lastDemand, ascending cell index. For each eligible target, select an available unit with a safe route by shortest route length then vehicle ID; never assign a target or unit twice. Move each unit at most one safe road cell. Return { events, controlled }, where controlled is a fresh grid-sized Uint8Array set only for a unit physically at its still-gridlocked target. Keep route planning deterministic and avoid repeated work for already-owned targets.
- [ ] **Step 4: Cover capacity and route-loss cases.** Confirm the returned mask is zero before arrival, one at an arrived controlled intersection, zero immediately when gridlock clears, and contains only binary values. Confirm a lost route emits COMMIT_CANCELLED, clears the assignment, and permits a later retry. Do not add new event types or metric fields.
- [ ] **Step 5: Run focused police and traffic suites.** Run pnpm exec vitest run src/sim/dispatch/police.test.ts src/sim/traffic/index.test.ts; expected: all pass, including the existing 0.5-versus-0.8 dark intersection test and unchanged powered capacity of 1.0.

## Task 3: Pass police control through agent traffic processing

**Files:** modify src/sim/agents/system.ts; modify src/sim/agents/system.test.ts.

- [ ] **Step 1: Add regression tests.** In a fresh agent test setup, add road cells 19 and 35 so road cell 27 has three road neighbors. Verify an uncontrolled dark cell has capacity 0.5, a controlled dark cell has capacity 0.8, and a controlled powered cell remains at capacity 1.0. Reject a malformed mask through the existing beginTrafficTick validation.

    it("uses the supplied police mask without changing powered intersection capacity", () => {
      const scenario = town();
      scenario.blocks[19] = BlockType.Road;
      scenario.blocks[35] = BlockType.Road;
      const { w, a, traffic, blocked } = setup(scenario);
      w.powered[27] = 0;
      stepAgents(a, w, scenario, 1, blocked, traffic);
      expect(traffic.capacity[27]).toBe(0.5);
      const control = new Uint8Array(64);
      control[27] = 1;
      stepAgents(a, w, scenario, 2, blocked, traffic, control);
      expect(traffic.capacity[27]).toBe(0.8);
      w.powered[27] = 1;
      stepAgents(a, w, scenario, 3, blocked, traffic, control);
      expect(traffic.capacity[27]).toBe(1);
    });
- [ ] **Step 2: Run the focused test and observe the expected signature failure.** Run pnpm exec vitest run src/sim/agents/system.test.ts; expected: the optional control-mask call fails to typecheck or has no traffic effect.
- [ ] **Step 3: Implement the narrow boundary change.** Extend stepAgents(a, world, scenario, tick, blocked, traffic, policeControlled?) and pass the optional mask directly to beginTrafficTick(traffic, world, policeControlled). Do not alter civilian movement, car routing, agent state, or traffic completion order.
- [ ] **Step 4: Run the agent and traffic suites.** Run pnpm exec vitest run src/sim/agents/system.test.ts src/sim/traffic/index.test.ts; expected: new controlled-throughput cases and all prior agent/traffic cases pass.

## Task 4: Runner tick order, events, and copied vehicle snapshots

**Files:** modify src/sim/runner.ts; modify src/sim/runner.test.ts.

- [ ] **Step 1: Write runner regressions.** Reuse stationScenario() with one police car and officer. Check initial snapshots include its police-car ID/kind only when safely deployed; IDs remain unique across civilian cars, ambulances, police, and boats; zero staffed units produce no police vehicle or police events. Run identical seeded simulations twice and compare events, vehicle arrays, and metrics byte-for-byte. Police-module tests cover assignment/release events; runner tests prove the separate police subsystem is composed without touching incident/rescue assignment state.
- [ ] **Step 2: Run the focused tests and observe the expected failures.** Run pnpm exec vitest run src/sim/runner.test.ts; expected: police vehicle is absent from runner snapshots.
- [ ] **Step 3: Integrate at the existing state boundary.** Initialize createPolice beside the other finite dispatch systems. After stepFlood, scheduled events, power, and updateClosures(tick + 1), call stepPolice using the previous completed traffic state and current hazards; append its events and pass its mask to stepAgents. Step order must ensure only physically arrived units affect the current traffic tick. Add police snapshot arrays through the existing joinedInt32/joinedFloat32/joinedUint8 helpers; policeSnapshot returns owned arrays with VehicleKind.PoliceCar and only available units.
- [ ] **Step 4: Assert behavior and compatibility.** Verify police actors use actorKind: "vehicle", assignment/cancellation reasons are nonempty, empty police fleets add no police vehicles/events, no new contract keys appear, and both centralised and negotiation runs keep police logic independent of rescue dispatch. Validate snapshots with RenderSnapshotSchema and summaries with RunSummarySchema.
- [ ] **Step 5: Run focused integration suites.** Run pnpm exec vitest run src/sim/runner.test.ts src/sim/dispatch/police.test.ts src/sim/agents/system.test.ts; expected: all pass.

## Task 5: Docs, broad verification, and local checkpoint

**Files:** modify docs/CHANGELOG.md; no shared contracts or other worker lanes.

- [ ] **Step 1: Add one implementation changelog line.** Record finite independent police dispatch, safe station access, gridlock assignment/control, reuse of the dark-intersection throughput hook, and tests/verification. State that M3E civilian escort and M3F crowd control remain the planned next slices.
- [ ] **Step 2: Run full required verification.** Run pnpm health and pnpm build. Then run three-seed batch and comparison smoke checks at 60 ticks using temporary JSON outputs, and git diff --check. Expected: lint, strict typecheck, all Vitest tests, schema validation, production build, both smoke commands, and whitespace check pass. Preserve the validator's schema-only/releaseReady:false limitation if it reports it.
- [ ] **Step 3: Review scope and commit.** Confirm git diff --exit-code -- src/contracts, review git diff --stat, stage only the M3D files, and create a local checkpoint such as feat(sim): add independent police traffic control. Do not push or merge unless separately requested.

## Plan self-review

- Design coverage: independent finite police role and reserved IDs (Tasks 1/4); safe station deployment and hazard-aware movement (Task 1); stable assignment, control activation/release, and retry (Task 2); existing traffic throughput with unchanged civilian movement (Task 3); state-boundary integration, events, and snapshots (Task 4); follow-on scope and verification (Task 5).
- Safety: tests cover unit/target exclusivity, safe entry, no control before arrival, powered versus dark capacity, route loss, no rescue ownership, copied snapshots, and deterministic replay.
- Contract boundary: no src/contracts edits; existing VehicleKind.PoliceCar, VehicleState, SimEvent, and snapshot arrays are reused.
- Follow-ons: M3E civilian escort and M3F crowd control are explicitly retained after M3D; neither is silently folded into this implementation.
- Scope: M3D does not implement police-specific fuel/failure injections, new metrics, rendering changes, helicopters, compound stress acceptance, or release signoff.
