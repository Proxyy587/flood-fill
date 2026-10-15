import { expect, it } from "vitest";
import { mockScenario } from "../../contracts/mocks/ak";
import { createWorld } from "../world/grid";
import { createPowerState, stepPower } from "./grid";

it("emits hospital diversion only on entry", () => {
  const s = mockScenario(); const w = createWorld(s); const p = createPowerState(s);
  w.water[14] = 2;
  const events = [0, 1, 2].flatMap((tick) => stepPower(w, s, p, tick));
  expect(events.filter((e) => e.type === "HOSPITAL_DIVERSION_ON")).toHaveLength(1);
});
it("restarts backup after interior flooding clears and logs the new activation", () => {
  const s = mockScenario(); const w = createWorld(s); const p = createPowerState(s);
  w.water[6] = 1; stepPower(w, s, p, 0);
  w.water[14] = 2; stepPower(w, s, p, 1);
  expect(p.onGenerator.has(s.buildings[1].id)).toBe(false);
  w.water[14] = 0; const events = stepPower(w, s, p, 2);
  expect(events.filter((e) => e.type === "GENERATOR_START")).toHaveLength(1);
  expect(w.powered[14]).toBe(2);
  expect(events.find((e) => e.type === "POWER_RESTORED")?.reason).not.toContain("Grid connectivity restored");
});
it("logs fuel exhaustion even when simultaneous interior flooding stops the generator", () => {
  const s = mockScenario(); s.buildings[1].generator = { fuelTicks: 1 };
  const w = createWorld(s); const p = createPowerState(s);
  w.water[6] = 1; stepPower(w, s, p, 0);
  w.water[14] = 2; const events = stepPower(w, s, p, 1);
  expect(events.filter((e) => e.type === "GENERATOR_EXHAUSTED")).toHaveLength(1);
  w.water[14] = 0;
  expect(stepPower(w, s, p, 2).some((e) => e.type === "GENERATOR_EXHAUSTED")).toBe(false);
});

it("propagates power then cascades a substation outage to loads", () => {
  const s = mockScenario(); const w = createWorld(s); const p = createPowerState(s);
  stepPower(w, s, p, 0); expect(w.powered[9]).toBe(1); expect(w.powered[14]).toBe(1);
  w.water[6] = 1;
  const events = stepPower(w, s, p, 1);
  expect(w.powered[9]).toBe(0); expect(w.powered[14]).toBe(2);
  expect(events.some((e) => e.type === "POWER_TRIP")).toBe(true);
  expect(events.some((e) => e.type === "GENERATOR_START")).toBe(true);
});
it("consumes fuel once per blackout tick and stops hospital service on exhaustion", () => {
  const s = mockScenario(); s.buildings[1].generator = { fuelTicks: 2 };
  const w = createWorld(s); const p = createPowerState(s); w.water[6] = 1;
  stepPower(w, s, p, 0); expect(w.powered[14]).toBe(2);
  stepPower(w, s, p, 1); expect(w.powered[14]).toBe(2);
  const events = stepPower(w, s, p, 2);
  expect(w.powered[14]).toBe(0);
  expect(events.some((e) => e.type === "GENERATOR_EXHAUSTED")).toBe(true);
  expect(p.diversion.has(s.buildings[1].id)).toBe(true);
});
it("does not trip twice or refuel a generator when flood water recedes", () => {
  const s = mockScenario(); const w = createWorld(s); const p = createPowerState(s);
  w.water[6] = 1; stepPower(w, s, p, 0);
  const fuel = p.fuel.get(s.buildings[1].id)!; w.water[6] = 0;
  const events = stepPower(w, s, p, 1);
  expect(events.filter((e) => e.type === "POWER_TRIP")).toHaveLength(0);
  expect(p.fuel.get(s.buildings[1].id)).toBe(fuel - 1);
});
