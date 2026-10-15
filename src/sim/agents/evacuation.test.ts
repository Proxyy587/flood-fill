import { expect, it } from "vitest";
import { BlockType, NpcState } from "../../contracts";
import type { BuildingId } from "../../contracts";
import { createSimulation } from "../runner";
import { livingFixture } from "./living-fixture";

function threatened(count: number, shelterCapacity: number) {
  const scenario = livingFixture();
  scenario.population = { count, mix: { carOwners: 0, limitedMobility: 0, needsAssist: 0 }, schedule: "custom", customSchedule: { departAt: 86399, workTicks: 86400 } };
  scenario.fleet = { ambulances: 0, policeCars: 0, boats: 0, helicopters: 0, doctors: 0, nurses: 0, policeOfficers: 0, boatOperators: 0 };
  const shelter = scenario.buildings.find((b) => b.type === BlockType.Shelter)!;
  shelter.capacity = shelterCapacity;
  scenario.weather.warningDelay = 0;
  scenario.weather.sources = [{ cell: 9, startT: 0, endT: 100, rate: 0.2 }];
  return scenario;
}

it("orders exposed residents to one reachable shelter and measures completed evacuation", () => {
  const sim = createSimulation(threatened(1, 2), 42, "negotiation", { durationTicks: 100 });
  while (!sim.done && !sim.summary().events.some((e) => e.type === "EVAC_ORDER")) sim.step();
  expect(sim.summary().events.some((e) => e.type === "EVAC_ORDER" && e.targetKind === "building")).toBe(true);
  while (!sim.done) sim.step();
  expect(sim.snapshot().npcs.state[0]).toBe(NpcState.ShelterInPlace);
  expect(sim.summary().metrics.at(-1)!.evacDonePct).toBe(100);
});

it("reserves shelter capacity once and leaves excess residents accounted as stranded", () => {
  const sim = createSimulation(threatened(2, 1), 42, "centralised", { durationTicks: 100 });
  while (!sim.done && !sim.summary().events.some((e) => e.type === "NPC_STRANDED")) sim.step();
  const orders = sim.summary().events.filter((e) => e.type === "EVAC_ORDER");
  expect(orders).toHaveLength(1);
  expect(orders[0].target).toBe(4);
  expect(sim.summary().events.filter((e) => e.type === "NPC_STRANDED")).toHaveLength(1);
  while (!sim.done) sim.step();
  expect(sim.summary().metrics.at(-1)!.stranded).toBeGreaterThan(0);
});

it("applies tick-zero shelter overflow before evacuation allocations", () => {
  const scenario = threatened(1, 2);
  scenario.injected = [{ kind: "shelter_overflow", tick: 0, buildingId: 4 as BuildingId }];
  const sim = createSimulation(scenario, 42, "negotiation", { durationTicks: 20 });
  expect(sim.summary().events.some((e) => e.type === "SHELTER_OVERFLOW" && e.tick === 0)).toBe(true);
  while (!sim.done) sim.step();
  expect(sim.summary().events.some((e) => e.type === "EVAC_ORDER")).toBe(false);
});

it("waits the configured warning delay after flood onset before broadcasting", () => {
  const scenario = threatened(1, 2); scenario.weather.warningDelay = 3;
  scenario.weather.sources = [{ cell: 9, startT: 0, endT: 100, rate: 0.06 }];
  const sim = createSimulation(scenario, 42, "negotiation", { durationTicks: 10 });
  while (!sim.done && !sim.summary().events.some((e) => e.type === "EVAC_ORDER")) sim.step();
  expect(sim.summary().events.find((e) => e.type === "EVAC_ORDER")?.tick).toBe(4);
});

it("releases a reserved shelter when that shelter overflows during an evacuation", () => {
  const scenario = threatened(1, 2);
  scenario.injected = [{ kind: "shelter_overflow", tick: 3, buildingId: 4 as BuildingId }];
  const sim = createSimulation(scenario, 42, "negotiation", { durationTicks: 30 });
  while (!sim.done) sim.step();
  const states = sim.snapshot().npcs.state;
  expect([...states]).not.toContain(NpcState.ShelterInPlace);
  expect([...states]).toContain(NpcState.Stranded);
  expect(sim.summary().events.some((e) => e.type === "SHELTER_OVERFLOW" && e.tick === 3)).toBe(true);
});

it("finishes the current commute edge before switching to the assigned shelter route", () => {
  const scenario = threatened(1, 2);
  const shelter = scenario.buildings.find((building) => building.type === BlockType.Shelter)!;
  scenario.blocks[46] = BlockType.Grass; scenario.blocks[8] = BlockType.Shelter;
  shelter.cells = [8]; shelter.entrance = 8;
  scenario.population.customSchedule!.departAt = 0;
  scenario.weather.sources = [{ cell: 9, startT: 1, endT: 100, rate: 0.2 }];
  const sim = createSimulation(scenario, 42, "negotiation", { durationTicks: 30 });
  sim.step(); const before = sim.snapshot();
  sim.step(); const after = sim.snapshot();
  expect(sim.summary().events.some((e) => e.type === "EVAC_ORDER")).toBe(true);
  expect(Math.hypot(after.npcs.x[0] - before.npcs.x[0], after.npcs.z[0] - before.npcs.z[0])).toBeLessThanOrEqual(0.5);
});
