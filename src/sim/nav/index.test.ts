import { describe, expect, it } from "vitest";
import { buildFlowField, findPath, type NavGrid } from "./index";

function openGrid(width: number, height: number): NavGrid {
  return { width, height, passable: new Uint8Array(width * height).fill(1) };
}

describe("findPath", () => {
  it("returns a shortest four-connected path including both endpoints", () => {
    expect(findPath(openGrid(3, 3), 0, 8)).toEqual([0, 1, 2, 5, 8]);
  });

  it("takes a detour around blocked cells", () => {
    const grid = openGrid(3, 3);
    grid.passable[1] = 0;
    grid.passable[4] = 0;
    expect(findPath(grid, 0, 2)).toEqual([0, 3, 6, 7, 8, 5, 2]);
  });

  it.each([0, 2])("rejects blocked endpoint %i with null", (blocked) => {
    const grid = openGrid(3, 1);
    grid.passable[blocked] = 0;
    expect(findPath(grid, 0, 2)).toBeNull();
  });

  it("returns a singleton only for a passable start equal to goal", () => {
    const grid = openGrid(1, 1);
    expect(findPath(grid, 0, 0)).toEqual([0]);
    grid.passable[0] = 0;
    expect(findPath(grid, 0, 0)).toBeNull();
  });

  it("does not wrap between row edges", () => {
    const grid = openGrid(3, 2);
    expect(findPath(grid, 2, 3)).toEqual([2, 1, 0, 3]);
    grid.passable.fill(0);
    grid.passable[2] = 1;
    grid.passable[3] = 1;
    expect(findPath(grid, 2, 3)).toBeNull();
  });

  it("minimizes entering-cell cost rather than number of steps", () => {
    const grid = openGrid(3, 2);
    grid.costs = new Float32Array([1, 9, 1, 1, 1, 1]);
    expect(findPath(grid, 0, 2)).toEqual([0, 3, 4, 5, 2]);
  });

  it("scales its heuristic for costs below one", () => {
    const grid = openGrid(3, 2);
    grid.costs = new Float32Array([1, 1, 0.125, 0.125, 0.125, 0.125]);
    expect(findPath(grid, 0, 2)).toEqual([0, 3, 4, 5, 2]);
  });

  it("returns null for disconnected cells", () => {
    const grid = openGrid(3, 1);
    grid.passable[1] = 0;
    expect(findPath(grid, 0, 2)).toBeNull();
  });

  it("breaks equal-priority ties by cell index consistently", () => {
    const grid = openGrid(3, 3);
    for (let run = 0; run < 10; run++) {
      expect(findPath(grid, 8, 0)).toEqual([8, 5, 2, 1, 0]);
    }
  });
});

describe("buildFlowField", () => {
  it("accumulates forward entering-cell costs during reverse search", () => {
    const grid = openGrid(3, 1);
    grid.costs = new Float32Array([20, 3, 7]);
    const field = buildFlowField(grid, [2]);
    expect(field.distance).toBeInstanceOf(Float64Array);
    expect(field.next).toBeInstanceOf(Int32Array);
    expect(Array.from(field.distance)).toEqual([10, 7, 0]);
    expect(Array.from(field.next)).toEqual([1, 2, 2]);
  });

  it("chooses the cheapest route to any target independently of target order", () => {
    const grid = openGrid(5, 1);
    const field = buildFlowField(grid, [4, 0, 4]);
    expect(Array.from(field.distance)).toEqual([0, 1, 2, 1, 0]);
    expect(Array.from(field.next)).toEqual([0, 0, 1, 4, 4]);
    expect(buildFlowField(grid, [0, 4])).toEqual(field);
  });

  it("uses stable next-cell ties on an open grid", () => {
    expect(Array.from(buildFlowField(openGrid(3, 3), [0]).next))
      .toEqual([0, 0, 1, 0, 1, 2, 3, 4, 5]);
  });

  it("leaves blocked and disconnected cells unreachable", () => {
    const grid = openGrid(5, 1);
    grid.passable[2] = 0;
    const field = buildFlowField(grid, [4]);
    expect(Array.from(field.distance)).toEqual([Infinity, Infinity, Infinity, 1, 0]);
    expect(Array.from(field.next)).toEqual([-1, -1, -1, 4, 4]);
  });

  it("does not wrap between row edges", () => {
    const grid = openGrid(3, 2);
    grid.passable.fill(0);
    grid.passable[2] = 1;
    grid.passable[3] = 1;
    expect(buildFlowField(grid, [3]).next[2]).toBe(-1);
  });

  it.each([{ targets: [] }, { targets: [1] }])("handles unavailable targets $targets", ({ targets }) => {
    const grid = openGrid(3, 1);
    grid.passable[1] = 0;
    const field = buildFlowField(grid, targets);
    expect(Array.from(field.distance)).toEqual([Infinity, Infinity, Infinity]);
    expect(Array.from(field.next)).toEqual([-1, -1, -1]);
  });

  it("ignores a blocked target while routing to a passable one", () => {
    const grid = openGrid(3, 1);
    grid.passable[0] = 0;
    expect(Array.from(buildFlowField(grid, [0, 2]).next)).toEqual([-1, 2, 2]);
  });
});

describe("search consistency", () => {
  it("matches independent relaxation across every 3x3 obstacle layout", () => {
    for (let mask = 0; mask < 512; mask++) {
      const grid = openGrid(3, 3);
      grid.costs = new Float32Array([0.125, 8, 2, 0.5, 4, 1, 2, 0.25, 1]);
      for (let cell = 0; cell < 9; cell++) grid.passable[cell] = (mask >> cell) & 1;
      const targets = [0, 8];
      const expected = new Float64Array(9).fill(Infinity);
      for (const target of targets) if (grid.passable[target]) expected[target] = 0;
      // Bellman-Ford over explicitly checked cell pairs: no heap or shared neighbor helper.
      for (let round = 0; round < 8; round++) {
        for (let from = 0; from < 9; from++) {
          if (!grid.passable[from]) continue;
          for (let to = 0; to < 9; to++) {
            if (!grid.passable[to]) continue;
            const separation = Math.abs(from % 3 - to % 3) +
              Math.abs(Math.floor(from / 3) - Math.floor(to / 3));
            if (separation === 1) {
              expected[from] = Math.min(expected[from], grid.costs[to] + expected[to]);
            }
          }
        }
      }
      const field = buildFlowField(grid, targets);
      expect(field.distance).toEqual(expected);
      for (let start = 0; start < 9; start++) {
        const paths = targets.map((target) => findPath(grid, start, target));
        const costs = paths.map((path) => path === null ? Infinity :
          path.slice(1).reduce((sum, cell) => sum + (grid.costs?.[cell] ?? 1), 0));
        expect(Math.min(...costs)).toBe(expected[start]);
        if (expected[start] === Infinity) {
          expect(field.next[start]).toBe(-1);
          continue;
        }
        let cell = start;
        let cost = 0;
        let steps = 0;
        while (!targets.includes(cell) && steps < 9) {
          const next = field.next[cell];
          expect(grid.passable[next]).toBe(1);
          expect(Math.abs(cell % 3 - next % 3) +
            Math.abs(Math.floor(cell / 3) - Math.floor(next / 3))).toBe(1);
          cost += grid.costs[next];
          cell = next;
          steps++;
        }
        expect(targets).toContain(cell);
        expect(cost).toBe(expected[start]);
      }
    }
  });

  it("grows the heap for a broad search frontier", () => {
    const grid = openGrid(100, 100);
    const field = buildFlowField(grid, [0]);
    for (let cell = 0; cell < 10000; cell++) {
      expect(field.distance[cell]).toBe(cell % 100 + Math.floor(cell / 100));
    }
    expect(findPath(grid, 9999, 0)).toHaveLength(199);
  });
});

describe("input validation and purity", () => {
  const malformed: NavGrid[] = [
    { width: 0, height: 1, passable: new Uint8Array() },
    { width: -1, height: 1, passable: new Uint8Array() },
    { width: 1.5, height: 2, passable: new Uint8Array(3) },
    { width: 1, height: NaN, passable: new Uint8Array(1) },
    { width: Infinity, height: 1, passable: new Uint8Array(1) },
    { width: 1, height: 0, passable: new Uint8Array() },
    { width: 65536, height: 65536, passable: new Uint8Array(1) },
    { ...openGrid(2, 2), passable: new Uint8Array(3) },
    { ...openGrid(2, 2), costs: new Float32Array(3).fill(1) },
    ...[0, -1, NaN, Infinity, -Infinity].map((cost) => ({
      ...openGrid(1, 1), costs: new Float32Array([cost]),
    })),
    { width: 1, height: 1, passable: new Uint8Array(1), costs: new Float32Array([0]) },
  ];

  it.each(malformed)("rejects malformed grid %#", (grid) => {
    expect(() => findPath(grid, 0, 0)).toThrow(RangeError);
    expect(() => buildFlowField(grid, [])).toThrow(RangeError);
  });

  it.each([-1, 3, 0.5, NaN, Infinity])("rejects invalid index %s", (index) => {
    const grid = openGrid(3, 1);
    expect(() => findPath(grid, index, 0)).toThrow(RangeError);
    expect(() => findPath(grid, 0, index)).toThrow(RangeError);
    expect(() => buildFlowField(grid, [0, index])).toThrow(RangeError);
  });

  it("validates every target even when preceding targets are blocked", () => {
    const grid = openGrid(1, 1);
    grid.passable[0] = 0;
    expect(() => buildFlowField(grid, [0, 1])).toThrow(RangeError);
  });

  it("reads input arrays without mutating them and sees subsequent edits", () => {
    const grid = openGrid(3, 1);
    grid.costs = new Float32Array([2, 3, 4]);
    const beforePassable = grid.passable.slice();
    const beforeCosts = grid.costs.slice();
    const targets = Object.freeze([2]);
    findPath(grid, 0, 2);
    buildFlowField(grid, targets);
    expect(grid.passable).toEqual(beforePassable);
    expect(grid.costs).toEqual(beforeCosts);
    grid.passable[1] = 0;
    expect(findPath(grid, 0, 2)).toBeNull();
    expect(buildFlowField(grid, targets).next[0]).toBe(-1);
  });
});
