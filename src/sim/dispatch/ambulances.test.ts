import { expect, it } from "vitest";
import { BlockType, VehicleKind, VehicleState } from "../../contracts/types";
import type { BuildingId } from "../../contracts/types";
import { createPopulation } from "../agents/population";
import { livingFixture } from "../agents/living-fixture";
import { createWorld } from "../world/grid";
import { createAmbulances, nearestSafeRoadRoute, planAmbulanceRoute, stepAmbulances, ambulanceSnapshot } from "./ambulances";

function setup(count = 2) {
  const scenario = livingFixture();
  scenario.fleet.ambulances = count;
  scenario.blocks[13] = BlockType.Road;
  scenario.blocks[12] = BlockType.Road;
  scenario.blocks[20] = BlockType.Road;
  scenario.blocks[21] = BlockType.Road;
  scenario.blocks[28] = BlockType.Road;
  scenario.blocks[29] = BlockType.Road;
  scenario.blocks[14] = BlockType.Hospital;
  scenario.buildings.find((building) => building.type === BlockType.Hospital)!.cells = [14];
  scenario.buildings.find((building) => building.type === BlockType.Hospital)!.entrance = 14;
  const population = createPopulation(scenario, 12);
  const world = createWorld(scenario);
  world.powered[14] = 1;
  const blocked = new Uint8Array(world.water.length);
  const ambulances = createAmbulances(scenario, world, blocked);
  return { scenario, population, world, blocked, ambulances };
}

it("creates exactly the configured finite fleet with noncolliding reserved vehicle IDs", () => {
  const { population, ambulances, scenario } = setup(2);
  const totalReserved = scenario.fleet.ambulances + scenario.fleet.policeCars + scenario.fleet.boats + scenario.fleet.helicopters;

  expect(ambulances.count).toBe(2);
  expect(Array.from(ambulances.id)).toEqual([1, 2]);
  expect(population.cars.id.every((id) => id > totalReserved)).toBe(true);
  expect(ambulances.id.some((id) => population.cars.id.includes(id))).toBe(false);
  expect(ambulanceSnapshot(ambulances).kind).toEqual(new Uint8Array([VehicleKind.Ambulance, VehicleKind.Ambulance]));
});

it("supports a zero-ambulance configured fleet", () => {
  const { ambulances } = setup(0);
  expect(ambulances.count).toBe(0);
  expect(ambulanceSnapshot(ambulances).id).toHaveLength(0);
});

it("starts at the safe road access cell adjacent to a powered operational hospital", () => {
  const { ambulances } = setup(1);
  expect(ambulances.available[0]).toBe(1);
  expect(ambulances.cell[0]).toBe(13);
});

it("keeps configured units unavailable when the map contains no safe road cell", () => {
  const { scenario } = setup(1);
  const buildingCells = new Set(scenario.buildings.flatMap((building) => building.cells));
  for (let cell = 0; cell < scenario.blocks.length; cell++) if (!buildingCells.has(cell)) scenario.blocks[cell] = BlockType.Grass;
  const emptyWorld = createWorld(scenario);
  const system = createAmbulances(scenario, emptyWorld, new Uint8Array(emptyWorld.water.length));
  expect(system.count).toBe(1);
  expect(system.available[0]).toBe(0);
  expect(system.cell[0]).toBe(-1);
  expect(ambulanceSnapshot(system).id).toHaveLength(0);
});

it("uses the nearest safe HQ road fallback, then the lowest-index safe road", () => {
  const { scenario, world, blocked } = setup(1);
  scenario.blocks[40] = BlockType.FloodHQ;
  scenario.blocks[41] = BlockType.Road;
  scenario.buildings.push({ id: 5 as BuildingId, type: BlockType.FloodHQ, cells: [40], entrance: 40, capacity: 0, floorHeight: 0 });
  world.block[40] = BlockType.FloodHQ;
  world.buildingId[40] = 5;
  world.block[41] = BlockType.Road;
  world.powered[14] = 0;
  expect(createAmbulances(scenario, world, blocked).cell[0]).toBe(41);

  scenario.buildings = scenario.buildings.filter((building) => building.type !== BlockType.FloodHQ);
  world.block[40] = BlockType.Grass;
  world.buildingId[40] = 0;
  expect(createAmbulances(scenario, world, blocked).cell[0]).toBe(12);
});

it("plans only adjacent car-safe road cells and advances one cell per tick", () => {
  const { scenario, world, blocked, ambulances } = setup(1);
  world.water[21] = 0.4;
  expect(planAmbulanceRoute(ambulances, 0, 24, world, scenario, blocked, 0)).toBe(true);
  expect(ambulances.state[0]).toBe(VehicleState.Moving);
  expect(ambulances.routes[0]!.cells[1]).toBe(12);
  expect(ambulances.routes[0]!.cells).not.toContain(21);
  stepAmbulances(ambulances, world, scenario, blocked, 0);
  expect(ambulances.cell[0]).toBe(12);
});

it("replans deterministically after a blocked route cell changes the navigation version", () => {
  const first = setup(1);
  const second = setup(1);
  expect(planAmbulanceRoute(first.ambulances, 0, 24, first.world, first.scenario, first.blocked, 0)).toBe(true);
  expect(planAmbulanceRoute(second.ambulances, 0, 24, second.world, second.scenario, second.blocked, 0)).toBe(true);
  first.blocked[20] = second.blocked[20] = 1;
  stepAmbulances(first.ambulances, first.world, first.scenario, first.blocked, 1);
  stepAmbulances(second.ambulances, second.world, second.scenario, second.blocked, 1);

  expect(first.ambulances.cell[0]).toBe(second.ambulances.cell[0]);
  expect(first.ambulances.cell[0]).toBe(21);
  expect(first.ambulances.routes[0]?.cells).toEqual(second.ambulances.routes[0]?.cells);
  expect(first.ambulances.routes[0]?.cells[1]).toBe(21);
});

it("routes an off-road incident to the nearest reachable safe road approach", () => {
  const { scenario, world, blocked, ambulances } = setup(1);
  expect(nearestSafeRoadRoute(ambulances.cell[0], 14, world, scenario, blocked)).toMatchObject({ accessCell: 13 });
  expect(nearestSafeRoadRoute(ambulances.cell[0], 14, world, scenario, blocked)?.route).toEqual(new Int32Array([13]));
  blocked[13] = 1;
  expect(nearestSafeRoadRoute(12, 14, world, scenario, blocked)?.accessCell).toBe(22);
});
