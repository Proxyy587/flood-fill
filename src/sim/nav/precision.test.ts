import { expect, it } from "vitest";
import { findPath, buildFlowField } from "./index";

it("rejects off-quantum costs and grids larger than the simulation limit", () => {
  const grid = { width: 1, height: 1, passable: new Uint8Array([1]), costs: new Float32Array([0.1]) };
  expect(() => findPath(grid, 0, 0)).toThrow(RangeError);
  expect(() => buildFlowField({ width: 129, height: 1, passable: new Uint8Array(129).fill(1) }, [0])).toThrow(RangeError);
});

it("rejects costs that cannot maintain exact path sums and flow descent", () => {
  const grid = { width: 2, height: 3, passable: new Uint8Array(6).fill(1), costs: new Float32Array([1, 1, 64, 128, 64, 2 ** 60]) };
  expect(() => findPath(grid, 4, 5)).toThrow(RangeError);
  expect(() => buildFlowField(grid, [5])).toThrow(RangeError);
});
it("keeps exact mixed-scale costs with strict flow descent", () => {
  const grid = { width: 2, height: 3, passable: new Uint8Array(6).fill(1), costs: new Float32Array([1 / 1024, 1, 64, 128, 64, 65536]) };
  const flow = buildFlowField(grid, [5]);
  for (let cell = 0; cell < 5; cell++) expect(flow.distance[flow.next[cell]]).toBeLessThan(flow.distance[cell]);
  expect(findPath(grid, 4, 5)).toEqual([4, 5]);
});
