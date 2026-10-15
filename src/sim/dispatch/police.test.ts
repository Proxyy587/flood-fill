import { expect, it } from "vitest";
import { BlockType, VehicleKind, VehicleState } from "../../contracts/types";
import type { Scenario } from "../../contracts/types";
import { livingFixture } from "../agents/living-fixture";
import { assertMovementEntry } from "../invariants/movement";
import { findPath } from "../nav";
import { buildHazardGrid } from "../nav/hazards";
import { beginTrafficTick, createTraffic } from "../traffic";
import { createWorld } from "../world/grid";
import { createPolice, planPoliceRoute, policeSnapshot, stepPolice } from "./police";

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
  if (options.safeStationRoad === false) for (const cell of [17, 19, 26]) scenario.blocks[cell] = BlockType.Grass;
  return scenario;
}

function setup(options: PoliceFixtureOptions = {}) {
  const scenario = stationScenario(options);
  const world = createWorld(scenario);
  const blocked = new Uint8Array(world.width * world.height);
  return { scenario, world, blocked, police: createPolice(scenario, world, blocked), traffic: createTraffic(world) };
}

function trafficFixture(options: PoliceFixtureOptions = {}) {
  const scenario = stationScenario(options);
  const world = createWorld(scenario);
  const blocked = new Uint8Array(64);
  const traffic = createTraffic(world);
  const police = createPolice(scenario, world, blocked);
  return { scenario, world, blocked, traffic, police };
}

function assignedTrafficFixture() {
  const fixture = trafficFixture();
  fixture.traffic.intersections[27] = 1;
  fixture.traffic.gridlock[27] = 1;
  stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1);
  return fixture;
}

it("caps the staffed police fleet and reserves IDs between ambulances and boats", () => {
  const { scenario, world } = setup({ ambulances: 2, policeCars: 3, policeOfficers: 2 });
  const police = createPolice(scenario, world, new Uint8Array(64));

  expect(police.count).toBe(2);
  expect(Array.from(police.id)).toEqual([3, 4]);
  expect(police.id.every((id) => id >= scenario.fleet.ambulances + 1 && id <= scenario.fleet.ambulances + scenario.fleet.policeCars)).toBe(true);
  const boatIds = Array.from({ length: scenario.fleet.boats }, (_, boat) => scenario.fleet.ambulances + scenario.fleet.policeCars + boat + 1);
  expect(police.id.some((id) => boatIds.includes(id))).toBe(false);
});

it("supports zero and mismatched vehicle or officer counts", () => {
  expect(setup({ policeCars: 0, policeOfficers: 3 }).police.count).toBe(0);
  expect(setup({ policeCars: 3, policeOfficers: 0 }).police.count).toBe(0);
  expect(setup({ policeCars: 1, policeOfficers: 4 }).police.count).toBe(1);
});

it("skips scanning gridlock targets when the staffed police fleet is empty", () => {
  const fixture = trafficFixture({ policeCars: 0, policeOfficers: 2 });
  let intersectionReads = 0;
  let gridlockReads = 0;
  fixture.traffic.intersections = new Proxy(fixture.traffic.intersections, {
    get(target, property) {
      if (typeof property === "string" && /^\d+$/.test(property)) intersectionReads++;
      return Reflect.get(target, property, target) as number;
    },
  });
  fixture.traffic.gridlock = new Proxy(fixture.traffic.gridlock, {
    get(target, property) {
      if (typeof property === "string" && /^\d+$/.test(property)) gridlockReads++;
      return Reflect.get(target, property, target) as number;
    },
  });

  const result = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1);

  expect(intersectionReads).toBe(0);
  expect(gridlockReads).toBe(0);
  expect(result.events).toEqual([]);
  expect(result.controlled).toEqual(new Uint8Array(64));
});

it("spawns only on safe road cells adjacent to a police station", () => {
  const { police } = setup();
  expect(police.available[0]).toBe(1);
  expect(police.cell[0]).toBe(17);
  expect(policeSnapshot(police)).toMatchObject({ kind: new Uint8Array([VehicleKind.PoliceCar]), state: new Uint8Array([VehicleState.Idle]) });
});

it("leaves the configured unit unavailable when no safe adjacent station road exists", () => {
  const { scenario, world } = setup({ safeStationRoad: false });
  const police = createPolice(scenario, world, new Uint8Array(64));

  expect(police.available[0]).toBe(0);
  expect(police.cell[0]).toBe(-1);
  expect(policeSnapshot(police).id).toHaveLength(0);
});

it("moves at most one car-safe road cell per tick", () => {
  const { scenario, world, blocked, police, traffic } = setup();
  expect(planPoliceRoute(police, 0, 27, world, scenario, blocked, 0)).toBe(true);
  stepPolice(police, traffic, world, scenario, blocked, 0, 1);

  expect(police.cell[0]).toBe(25);
  assertMovementEntry(world, 17, police.cell[0], "car", blocked);
  expect(police.routes[0]?.cursor).toBe(2);
  expect(police.state[0]).toBe(VehicleState.Moving);
});

it("does not enter flooded or explicitly blocked roads", () => {
  const flooded = setup();
  expect(planPoliceRoute(flooded.police, 0, 27, flooded.world, flooded.scenario, flooded.blocked, 0)).toBe(true);
  flooded.world.water[25] = 0.31;
  stepPolice(flooded.police, flooded.traffic, flooded.world, flooded.scenario, flooded.blocked, 1, 1);
  expect(flooded.police.cell[0]).toBe(17);
  expect(flooded.police.cell[0]).not.toBe(25);

  const closed = setup();
  expect(planPoliceRoute(closed.police, 0, 27, closed.world, closed.scenario, closed.blocked, 0)).toBe(true);
  closed.blocked[25] = 1;
  stepPolice(closed.police, closed.traffic, closed.world, closed.scenario, closed.blocked, 1, 1);
  expect(closed.police.cell[0]).toBe(17);
  expect(closed.police.cell[0]).not.toBe(25);
});

it("replans deterministically when the navigation version changes", () => {
  const first = setup();
  const second = setup();
  for (const fixture of [first, second]) {
    for (const cell of [33, 34]) {
      fixture.scenario.blocks[cell] = BlockType.Road;
      fixture.world.block[cell] = BlockType.Road;
    }
    expect(planPoliceRoute(fixture.police, 0, 27, fixture.world, fixture.scenario, fixture.blocked, 0)).toBe(true);
    fixture.blocked[26] = 1;
    stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 1, 1);
  }

  expect(first.police.cell[0]).toBe(25);
  expect(Array.from(first.police.routes[0]!.cells)).toEqual(Array.from(second.police.routes[0]!.cells));
  expect(first.police.routes[0]!.cells).toContain(33);
});

it("cancels and clears ownership when the route becomes unreachable", () => {
  const { scenario, world, blocked, police, traffic } = setup();
  expect(planPoliceRoute(police, 0, 27, world, scenario, blocked, 0)).toBe(true);
  blocked[25] = 1;
  blocked[19] = 1;
  const result = stepPolice(police, traffic, world, scenario, blocked, 1, 5);

  expect(police.routes[0]).toBeNull();
  expect(police.target[0]).toBe(-1);
  expect(police.assignment[0]).toBe(-1);
  expect(result.events[0]).toMatchObject({ type: "COMMIT_CANCELLED", tick: 5 });
  expect(result.events[0]?.reason).toContain("route");

  blocked[25] = 0;
  blocked[19] = 0;
  expect(police.available[0]).toBe(1);
  expect(planPoliceRoute(police, 0, 35, world, scenario, blocked, 2)).toBe(true);
  expect(police.target[0]).toBe(35);
  expect(police.state[0]).toBe(VehicleState.Moving);
});

it.each([
  { description: "higher waited time", waited26: 5, demand26: 99, waited27: 6, demand27: 0, expected: 27 },
  { description: "higher demand after waited-time tie", waited26: 5, demand26: 3, waited27: 5, demand27: 4, expected: 27 },
  { description: "lower cell after waited-time and demand tie", waited26: 5, demand26: 4, waited27: 5, demand27: 4, expected: 26 },
])("assigns the highest-priority reachable target by $description with one unit", ({ waited26, demand26, waited27, demand27, expected }) => {
  const fixture = trafficFixture();
  fixture.world.block[34] = BlockType.Road;
  fixture.scenario.blocks[34] = BlockType.Road;
  for (const [cell, waited, demand] of [[26, waited26, demand26], [27, waited27, demand27]]) {
    fixture.traffic.intersections[cell] = 1;
    fixture.traffic.gridlock[cell] = 1;
    fixture.traffic.waited[cell] = waited;
    fixture.traffic.lastDemand[cell] = demand;
  }

  stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1);

  expect(Array.from(fixture.police.assignment)).toEqual([expected]);
  expect(fixture.police.assignment).not.toContain(expected === 26 ? 27 : 26);
});

it("breaks equal target priority by cell and equal routes by vehicle ID", () => {
  const fixture = trafficFixture({ policeCars: 2, policeOfficers: 2 });
  fixture.world.block[34] = BlockType.Road;
  fixture.scenario.blocks[34] = BlockType.Road;
  for (const cell of [26, 27]) {
    fixture.traffic.intersections[cell] = 1;
    fixture.traffic.gridlock[cell] = 1;
    fixture.traffic.waited[cell] = 7;
    fixture.traffic.lastDemand[cell] = 4;
  }
  expect(fixture.police.cell[0]).toBe(17);
  expect(fixture.police.cell[1]).toBe(19);
  stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1);
  expect(Array.from(fixture.police.assignment)).toEqual([26, 27]);
});

it("selects the shortest reachable police route, then lower vehicle ID for equal routes", () => {
  const nearest = trafficFixture({ policeCars: 2, policeOfficers: 2 });
  nearest.traffic.intersections[27] = 1;
  nearest.traffic.gridlock[27] = 1;
  stepPolice(nearest.police, nearest.traffic, nearest.world, nearest.scenario, nearest.blocked, 0, 1);
  expect(Array.from(nearest.police.assignment)).toEqual([-1, 27]);

  const tied = trafficFixture({ policeCars: 2, policeOfficers: 2 });
  tied.world.block[34] = BlockType.Road;
  tied.scenario.blocks[34] = BlockType.Road;
  tied.traffic.intersections[26] = 1;
  tied.traffic.gridlock[26] = 1;
  const grid = buildHazardGrid(tied.world, tied.scenario, "car", tied.blocked);
  expect(findPath(grid, tied.police.cell[0], 26)).toHaveLength(3);
  expect(findPath(grid, tied.police.cell[1], 26)).toHaveLength(3);
  stepPolice(tied.police, tied.traffic, tied.world, tied.scenario, tied.blocked, 0, 1);
  expect(Array.from(tied.police.assignment)).toEqual([26, -1]);
});

it("never assigns a non-intersection or a cleared intersection", () => {
  const fixture = trafficFixture();
  fixture.traffic.gridlock[35] = 1;
  fixture.traffic.intersections[27] = 1;
  fixture.traffic.gridlock[27] = 0;
  stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1);
  expect(fixture.police.assignment[0]).toBe(-1);
  expect(fixture.police.target[0]).toBe(-1);
});

it("dispatches to a gridlocked intersection and controls it only on arrival", () => {
  const fixture = trafficFixture();
  fixture.traffic.intersections[27] = 1;
  fixture.traffic.gridlock[27] = 1;
  const first = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1);
  expect(first.events).toContainEqual(expect.objectContaining({
    tick: 1,
    type: "ASSIGNED",
    actor: fixture.police.id[0],
    actorKind: "vehicle",
    cell: 27,
    reason: expect.stringMatching(/gridlock/i),
  }));
  const second = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 2);
  const third = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 3);
  expect(fixture.police.assignment[0]).toBe(27);
  expect([first.controlled[27], second.controlled[27], third.controlled[27]]).toEqual([0, 0, 1]);
  expect(third.controlled.every((value) => value <= 1)).toBe(true);
  expect(third.controlled).not.toBe(second.controlled);
});

it("releases a cleared target and makes the arrived unit reusable", () => {
  const fixture = assignedTrafficFixture();
  for (let tick = 2; tick <= 4; tick++) stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, tick);
  expect(fixture.police.cell[0]).toBe(27);
  fixture.traffic.gridlock[27] = 0;
  const released = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 5);
  expect(released.controlled[27]).toBe(0);
  expect(fixture.police.assignment[0]).toBe(-1);
  expect(fixture.police.target[0]).toBe(-1);
  expect(released.events).toContainEqual(expect.objectContaining({
    tick: 5,
    type: "COMMIT_CANCELLED",
    actor: fixture.police.id[0],
    actorKind: "vehicle",
    cell: 27,
    reason: expect.stringMatching(/gridlock.*clear|clear.*gridlock/i),
  }));
  fixture.traffic.intersections[26] = 1;
  fixture.traffic.gridlock[26] = 1;
  stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 6);
  expect(fixture.police.assignment[0]).toBe(26);
});

it("keeps powered gridlock eligible without claiming a control effect before arrival", () => {
  const fixture = trafficFixture();
  fixture.world.powered[27] = 1;
  fixture.traffic.intersections[27] = 1;
  fixture.traffic.gridlock[27] = 1;
  const result = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1);
  expect(fixture.police.assignment[0]).toBe(27);
  expect(result.controlled[27]).toBe(0);
});

it("projects arrived control through traffic capacity without boosting powered roads", () => {
  const fixture = trafficFixture();
  fixture.traffic.intersections[27] = 1;
  fixture.traffic.gridlock[27] = 1;
  let result = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1);
  for (let tick = 2; tick <= 3; tick++) {
    result = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, tick);
  }
  beginTrafficTick(fixture.traffic, fixture.world, result.controlled);
  expect(fixture.traffic.capacity[27]).toBe(0.8);
  fixture.world.powered[27] = 1;
  beginTrafficTick(fixture.traffic, fixture.world, result.controlled);
  expect(fixture.traffic.capacity[27]).toBe(1);
});

it("cancels a closed dispatch route, clears ownership, and retries safely", () => {
  const fixture = trafficFixture();
  fixture.traffic.intersections[27] = 1;
  fixture.traffic.gridlock[27] = 1;
  stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1);
  fixture.blocked[25] = 1;
  fixture.blocked[19] = 1;
  const failed = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 1, 2);
  expect(failed.events).toContainEqual(expect.objectContaining({
    tick: 2,
    type: "COMMIT_CANCELLED",
    actor: fixture.police.id[0],
    actorKind: "vehicle",
    cell: 27,
    reason: expect.stringMatching(/route/i),
  }));
  expect(failed.events.find((event) => event.type === "COMMIT_CANCELLED")?.reason.length).toBeGreaterThan(0);
  expect(fixture.police.assignment[0]).toBe(-1);
  expect(fixture.police.target[0]).toBe(-1);
  expect(fixture.police.routes[0]).toBeNull();
  fixture.blocked[25] = 0;
  fixture.blocked[19] = 0;
  stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 2, 3);
  expect(fixture.police.assignment[0]).toBe(27);
});

it("reports the assigned intersection when the next route step becomes unsafe", () => {
  const fixture = trafficFixture();
  fixture.traffic.intersections[27] = 1;
  fixture.traffic.gridlock[27] = 1;
  stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 1);
  fixture.blocked[26] = 1;

  const failed = stepPolice(fixture.police, fixture.traffic, fixture.world, fixture.scenario, fixture.blocked, 0, 2);

  expect(failed.events).toContainEqual(expect.objectContaining({
    tick: 2,
    type: "COMMIT_CANCELLED",
    actor: fixture.police.id[0],
    actorKind: "vehicle",
    cell: 27,
    reason: expect.stringMatching(/route.*unsafe/i),
  }));
});
