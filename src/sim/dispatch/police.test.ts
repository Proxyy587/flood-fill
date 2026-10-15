import { expect, it } from "vitest";
import { BlockType, VehicleKind, VehicleState } from "../../contracts/types";
import type { Scenario } from "../../contracts/types";
import { livingFixture } from "../agents/living-fixture";
import { assertMovementEntry } from "../invariants/movement";
import { createTraffic } from "../traffic";
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
