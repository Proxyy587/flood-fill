import { expect, it } from "vitest";
import { BlockType, VehicleKind, VehicleState } from "../../contracts/types";
import { livingFixture } from "../agents/living-fixture";
import { createWorld } from "../world/grid";
import { boatSnapshot, createBoats, loadBoatPassenger, planBoatRoute, stepBoats } from "./boats";

function setup(boats = 2, operators = 1) {
  const scenario = livingFixture();
  scenario.fleet.boats = boats;
  scenario.fleet.boatOperators = operators;
  scenario.blocks[9] = BlockType.BoatDepot;
  const depot = scenario.buildings.find((building) => building.id === 1)!;
  depot.type = BlockType.BoatDepot;
  depot.capacity = boats;
  const world = createWorld(scenario);
  for (const cell of [8, 16, 24, 25]) world.water[cell] = 0.6;
  return { scenario, world, blocked: new Uint8Array(64) };
}

it("creates a finite operator-bounded fleet with reserved boat IDs and four seats", () => {
  const { scenario, world, blocked } = setup(3, 2);
  const boats = createBoats(scenario, world, blocked);
  expect(boats.count).toBe(2);
  expect(Array.from(boats.id)).toEqual([3, 4]);
  expect(Array.from(boats.passengers)).toEqual([-1, -1, -1, -1, -1, -1, -1, -1]);
  expect(boats.available).toEqual(new Uint8Array([1, 1]));
  expect(boatSnapshot(boats).kind).toEqual(new Uint8Array([VehicleKind.Boat, VehicleKind.Boat]));
});

it("does not teleport a configured boat when no safe depot water access exists", () => {
  const { scenario, world, blocked } = setup(1, 1);
  scenario.buildings = scenario.buildings.filter((building) => building.type !== BlockType.BoatDepot);
  scenario.blocks[9] = BlockType.Grass;
  world.block[9] = BlockType.Grass;
  world.water.fill(0);
  const boats = createBoats(scenario, world, blocked);
  expect(boats.count).toBe(1);
  expect(boats.available[0]).toBe(0);
  expect(boats.cell[0]).toBe(-1);
  expect(boatSnapshot(boats).id).toHaveLength(0);
});

it("routes and advances only through navigable water, then deterministically replans", () => {
  const { scenario, world, blocked } = setup(1, 1);
  const boats = createBoats(scenario, world, blocked);
  expect(boats.cell[0]).toBe(8);
  expect(planBoatRoute(boats, 0, 25, world, scenario, blocked, 0)).toBe(true);
  stepBoats(boats, world, scenario, blocked, 0);
  expect(boats.cell[0]).toBe(16);
  expect(boats.state[0]).toBe(VehicleState.Moving);
  world.water[25] = 0;
  expect(planBoatRoute(boats, 0, 25, world, scenario, blocked, 1)).toBe(false);
});

it("rejects duplicate passengers and never loads beyond four seats", () => {
  const { scenario, world, blocked } = setup(1, 1);
  const boats = createBoats(scenario, world, blocked);
  expect([0, 1, 2, 3].map((patient) => loadBoatPassenger(boats, 0, patient))).toEqual([true, true, true, true]);
  expect(loadBoatPassenger(boats, 0, 4)).toBe(false);
  expect(loadBoatPassenger(boats, 0, 0)).toBe(false);
  expect(boats.passengerCount[0]).toBe(4);
});
