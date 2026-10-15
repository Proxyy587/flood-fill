import { expect, it } from "vitest";
import { createRng } from "./rng";

it("replays an identical seeded sequence with values in [0,1)", () => {
  const a = createRng(42); const b = createRng(42);
  const values = Array.from({ length: 1000 }, () => a.next());
  expect(values).toEqual(Array.from({ length: 1000 }, () => b.next()));
  expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  expect(new Set(values).size).toBeGreaterThan(990);
});
it("supports zero and differentiates seeds", () => {
  expect(createRng(0).next()).not.toBe(createRng(1).next());
});
it.each([-1, 1.5, NaN, 0x100000000])("rejects invalid seed %s", (seed) => {
  expect(() => createRng(seed)).toThrow(RangeError);
});
