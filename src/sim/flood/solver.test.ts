import { expect, it } from "vitest";
import { mockScenario } from "../../contracts/mocks/ak";
import { BlockType } from "../../contracts/types";
import { createWorld } from "../world/grid";
import { stepFlood, totalWater } from "./solver";

function basin() { const w = createWorld(mockScenario()); w.block.fill(BlockType.Rock); return w; }
it("stops pipe momentum at a sill after overtopping", () => {
  const w = basin(); w.ground.fill(10); w.ground[0] = 0; w.ground[1] = 0;
  w.barrier[1] = 1; w.water[0] = 1.1;
  for (let tick = 0; tick < 10; tick++) stepFlood(w, { rain: 0, sources: [], tick, soakRate: 0, drainRate: 0 });
  expect(w.water[0]).toBeGreaterThanOrEqual(1);
  expect(w.water[1]).toBeLessThanOrEqual(0.100001);
  expect(totalWater(w)).toBeCloseTo(1.1, 5);
});
it("rejects overflow sources before mutating water", () => {
  const w = basin(); const before = w.water.slice();
  expect(() => stepFlood(w, { rain: 0.1, sources: [{ cell: 0, startT: 0, endT: 2, rate: 1e40 }], tick: 0 })).toThrow();
  expect(w.water).toEqual(before);
});
it("conserves water in a closed basin over 500 ticks with no sinks", () => {
  const w = basin(); w.water[0] = 100;
  for (let t = 0; t < 500; t++) stepFlood(w, { rain: 0, sources: [], tick: t, soakRate: 0, drainRate: 0 });
  expect(totalWater(w)).toBeCloseTo(100, 3);
  expect([...w.water].every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  expect(w.water[63]).toBeGreaterThan(0);
});
it("accounts for rain, half-open source intervals and drainage sinks", () => {
  const w = basin(); w.block[0] = BlockType.Drainage;
  const sources = [{ cell: 0, startT: 1, endT: 2, rate: 3 }];
  const result = stepFlood(w, { rain: 0.01, sources, tick: 1, soakRate: 0, drainRate: 0.1 });
  expect(result.added).toBeCloseTo(3.64, 5);
  expect(totalWater(w)).toBeCloseTo(result.before + result.added - result.removed, 5);
  const next = stepFlood(w, { rain: 0, sources, tick: 2, soakRate: 0, drainRate: 0 });
  expect(next.added).toBe(0);
});
it("pools in low terrain and cannot pass a tall barrier", () => {
  const w = basin(); w.ground.fill(10); w.ground[0] = 0; w.ground[1] = 0; w.water[0] = 2;
  for (let t = 0; t < 20; t++) stepFlood(w, { rain: 0, sources: [], tick: t, soakRate: 0, drainRate: 0 });
  expect(w.water[1]).toBeGreaterThan(0.5);
  expect(w.water[8]).toBe(0);
});
it("reduces ponding with drainage and respects unpowered pumps", () => {
  const a = basin(); const b = basin(); a.water.fill(1); b.water.fill(1);
  a.block[0] = BlockType.Drainage; b.block[0] = BlockType.Drainage;
  a.powered[0] = 1;
  for (let tick = 0; tick < 30; tick++) {
    stepFlood(a, { rain: 0, sources: [], tick, soakRate: 0, pumpsNeedPower: true });
    stepFlood(b, { rain: 0, sources: [], tick, soakRate: 0, pumpsNeedPower: true });
  }
  expect(totalWater(a)).toBeLessThan(totalWater(b));
  expect(totalWater(b)).toBeCloseTo(64, 3);
});
