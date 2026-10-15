import { expect, it } from "vitest";
import { mockScenario } from "../../contracts/mocks/ak";
import { NpcRole } from "../../contracts/types";
import { createPopulation } from "./population";

it("creates exact civilian/staff counts and stable car IDs with seeded attributes", () => {
  const s = mockScenario(); const a = createPopulation(s, 42); const b = createPopulation(s, 42);
  expect(a.npcs.id.length).toBe(12); expect(a.cars.id.length).toBe(2);
  expect([...a.cars.id]).toEqual([5, 6]);
  expect([...a.npcs.role].filter((role) => role === NpcRole.Doctor)).toHaveLength(2);
  expect(a.npcs.speed).toEqual(b.npcs.speed); expect(a.npcs.hasCar).toEqual(b.npcs.hasCar);
  expect(a.npcs.speed).not.toEqual(createPopulation(s, 43).npcs.speed);
});
it("does not overbook houses or civilian workplaces", () => {
  const s = mockScenario(); const p = createPopulation(s, 42);
  expect([...p.npcs.homeBuilding].filter((id) => id === 1)).toHaveLength(6);
  expect([...p.npcs.unhoused].filter(Boolean)).toHaveLength(6);
  expect([...p.npcs.work].slice(0, 6)).toEqual(Array(6).fill(-1));
});
it("keeps every sampled attribute and mobility distribution bounded", () => {
  const p = createPopulation(mockScenario(), 0);
  expect([...p.npcs.speed].every((v) => v >= 0.6 - 1e-6 && v <= 1.4 + 1e-6)).toBe(true);
  for (const values of [p.npcs.panic, p.npcs.compliance, p.npcs.riskTolerance, p.npcs.altruism, p.npcs.awareness]) expect([...values].every((v) => v >= 0 && v <= 1)).toBe(true);
  expect([...p.npcs.health].every((v) => v === 100)).toBe(true);
});
it("initial sliders shift distributions without removing individual variation", () => {
  const base = createPopulation(mockScenario(), 42);
  const p = createPopulation(mockScenario(), 42, { npcParams: { ...base.params, panicMean: 0.9, carOwnership: 1 } });
  expect(p.cars.id.length).toBe(6);
  expect(p.npcs.panic[0]).toBeGreaterThan(base.npcs.panic[0]);
  expect(new Set(p.npcs.panic).size).toBeGreaterThan(1);
});
it("uses explicit custom schedules and keeps empty cities valid", () => {
  const s = mockScenario(); s.population.schedule = "custom";
  s.population.customSchedule = { departAt: 10, workTicks: 5 };
  const p = createPopulation(s, 42, { startTimeSeconds: 5 });
  expect(p.npcs.departTick[0]).toBe(5); expect(p.npcs.workDuration[0]).toBe(5);
  s.population.count = 0;
  s.fleet = { ambulances: 0, policeCars: 0, boats: 0, helicopters: 0, doctors: 0, nurses: 0, policeOfficers: 0, boatOperators: 0 };
  expect(createPopulation(s, 42).npcs.id).toHaveLength(0);
});
it("rechecks car budgets after per-run slider overrides", () => {
  const s = mockScenario(); s.fleet.ambulances = 9995;
  const base = createPopulation(s, 42);
  expect(() => createPopulation(s, 42, { npcParams: { ...base.params, carOwnership: 1 } })).toThrow(/vehicle budget/);
});
it.each(["office-hours", "night"] as const)("uses the %s clock and seeded early staff departures", (schedule) => {
  const s = mockScenario(); s.population.schedule = schedule;
  const p = createPopulation(s, 42);
  expect(p.startTime).toBe(schedule === "night" ? 71700 : 28500);
  for (let i = 0; i < s.population.count; i++) {
    expect(p.npcs.departTick[i]).toBeGreaterThanOrEqual(180);
    expect(p.npcs.departTick[i]).toBeLessThanOrEqual(420);
    expect(p.npcs.workDuration[i]).toBe(28800);
  }
  expect([...p.npcs.departTick].slice(s.population.count).every((tick) => tick === 0)).toBe(true);
});
