import { expect, it } from "vitest";
import { NpcState } from "../../contracts/types";
import { createPopulation, defaultNpcParams } from "../agents/population";
import { livingFixture } from "../agents/living-fixture";
import { createWorld } from "../world/grid";
import { stepExposure, triageHealth } from "./hospitals";

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
