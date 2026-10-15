import { expect, it } from "vitest";
import { BlockType, NpcState } from "../../contracts/types";
import type { BuildingId } from "../../contracts/types";
import { createPopulation, defaultNpcParams } from "../agents/population";
import { livingFixture } from "../agents/living-fixture";
import { createWorld } from "../world/grid";
import { admitPatientToHospital, createHospitalSystem, reserveHospitalBed, stepExposure, triageHealth } from "./hospitals";

function setup() {
  const scenario = livingFixture();
  scenario.population.count = 1;
  const population = createPopulation(scenario, 5, { npcParams: defaultNpcParams(scenario) });
  const world = createWorld(scenario);
  return { population, world, cell: population.npcs.cell[0] };
}

it("applies deterministic flood exposure only to distressed civilians in water", () => {
  const { population, world, cell } = setup();
  population.npcs.state[0] = NpcState.SeekHelp;
  world.water[cell] = 1.3;

  stepExposure(population, world, new Uint8Array(1));
  expect(population.npcs.health[0]).toBe(99.25);
});

it("does not apply exposure outside distress or at the threshold depth", () => {
  const { population, world, cell } = setup();
  world.water[cell] = 0.3;
  population.npcs.state[0] = NpcState.SeekHelp;
  stepExposure(population, world, new Uint8Array(1));
  population.npcs.state[0] = NpcState.AtHome;
  world.water[cell] = 2;
  stepExposure(population, world, new Uint8Array(1));

  expect(population.npcs.health[0]).toBe(100);
});

it("clamps exposure health at zero and stops it for a loaded patient", () => {
  const { population, world, cell } = setup();
  population.npcs.state[0] = NpcState.Stranded;
  population.npcs.health[0] = 0.5;
  world.water[cell] = 2;
  stepExposure(population, world, new Uint8Array(1));
  expect(population.npcs.health[0]).toBe(0);
  population.npcs.health[0] = 40;
  stepExposure(population, world, new Uint8Array([1]));
  expect(population.npcs.health[0]).toBe(40);
});

it.each([
  [75.01, "minor"],
  [75, "moderate"],
  [50.01, "moderate"],
  [50, "severe"],
  [0, "severe"],
] as const)("triages health %s as %s", (health, expected) => {
  expect(triageHealth(health)).toBe(expected);
});

function hospitalSetup() {
  const scenario = livingFixture();
  scenario.blocks[13] = BlockType.Road;
  scenario.blocks[21] = BlockType.Road;
  scenario.blocks[29] = BlockType.Road;
  scenario.blocks[34] = BlockType.Hospital;
  scenario.buildings.find((building) => building.id === 2)!.capacity = 2;
  scenario.buildings.push({ id: 5 as BuildingId, type: BlockType.Hospital, cells: [34], entrance: 34, capacity: 10, floorHeight: 1 });
  const world = createWorld(scenario);
  world.powered[14] = 1;
  world.powered[34] = 1;
  const system = createHospitalSystem(scenario, 4);
  const blocked = new Uint8Array(world.water.length);
  return { scenario, world, system, blocked };
}

it("routes severe patients by fastest ETA but capacity-balances minor patients", () => {
  const { scenario, world, system, blocked } = hospitalSetup();
  const severe = reserveHospitalBed(system, 0, 20, 13, world, scenario, blocked);
  expect(severe?.hospitalId).toBe(2);
  const minor = reserveHospitalBed(system, 1, 90, 13, world, scenario, blocked);
  expect(minor?.hospitalId).toBe(5);
  const secondSevere = reserveHospitalBed(system, 2, 30, 13, world, scenario, blocked);
  expect(secondSevere?.hospitalId).toBe(2);
});

it("reserves one bed atomically, admits only reserved patients and rejects duplicate admission", () => {
  const { scenario, world, system, blocked } = hospitalSetup();
  const first = reserveHospitalBed(system, 0, 20, 13, world, scenario, blocked);
  const repeated = reserveHospitalBed(system, 0, 20, 13, world, scenario, blocked);
  expect(repeated?.hospitalId).toBe(first?.hospitalId);
  expect(system.reserved[0]).toBe(1);
  expect(admitPatientToHospital(system, 0)).toBe(true);
  expect(system.reserved[0]).toBe(0);
  expect(system.occupied[0]).toBe(1);
  expect(admitPatientToHospital(system, 0)).toBe(false);
  expect(system.occupied[0]).toBe(1);
});

it("releases a reservation and retries at another hospital after power loss", () => {
  const { scenario, world, system, blocked } = hospitalSetup();
  expect(reserveHospitalBed(system, 0, 20, 13, world, scenario, blocked)?.hospitalId).toBe(2);
  world.powered[14] = 0;

  const diverted = reserveHospitalBed(system, 0, 20, 13, world, scenario, blocked);
  expect(diverted?.hospitalId).toBe(5);
  expect(system.reserved[0]).toBe(0);
  expect(system.reserved[1]).toBe(1);
});

it("never reserves capacity at a flooded, unpowered or zero-capacity hospital", () => {
  const { scenario, world, system, blocked } = hospitalSetup();
  world.powered[14] = 0;
  world.powered[34] = 0;
  world.water[14] = 2;

  expect(reserveHospitalBed(system, 0, 20, 13, world, scenario, blocked)).toBeUndefined();
  scenario.buildings.find((building) => building.id === 2)!.capacity = 0;
  expect(reserveHospitalBed(system, 1, 20, 13, world, scenario, blocked)).toBeUndefined();
  world.powered[34] = 1;
  scenario.buildings.find((building) => building.id === 5)!.capacity = 0;
  const noBeds = createHospitalSystem(scenario, 2);
  expect(reserveHospitalBed(noBeds, 0, 20, 13, world, scenario, blocked)).toBeUndefined();
});

it("does not overbook a full hospital when no other powered destination is available", () => {
  const { scenario, world, system, blocked } = hospitalSetup();
  system.capacity[0] = 1;
  world.powered[34] = 0;
  expect(reserveHospitalBed(system, 0, 20, 13, world, scenario, blocked)?.hospitalId).toBe(2);
  expect(reserveHospitalBed(system, 1, 20, 13, world, scenario, blocked)).toBeUndefined();
  expect(system.reserved[0]).toBe(1);
});
