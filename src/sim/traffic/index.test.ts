import { describe, expect, it } from "vitest";
import { BlockType, type SimEvent } from "../../contracts/types";
import type { World } from "../world/grid";
import {
  beginTrafficTick, congestionFactors, createTraffic, finishTrafficTick,
  gridlockCells, markTrafficWaiting, tryEnterTraffic,
} from "./index";

function world(width = 3, height = 3, roads = [1, 3, 4, 5, 7]): World {
  const size = width * height;
  const block = new Uint8Array(size);
  for (const cell of roads) block[cell] = BlockType.Road;
  return {
    width, height, block, ground: new Uint8Array(size), buildingId: new Int32Array(size),
    water: new Float32Array(size), flow: new Float32Array(size * 4),
    powered: new Uint8Array(size).fill(1), barrier: new Float32Array(size),
    scratch: new Float64Array(size), bridgeDeck: new Float32Array(size),
  };
}

function drain(state: ReturnType<typeof createTraffic>, cell: number): number {
  let count = 0;
  while (tryEnterTraffic(state, cell)) {
    count++;
    if (count > 10) throw new Error("Unbounded admission budget");
  }
  return count;
}

describe("traffic throughput credits", () => {
  it("creates an independent typed-array sidecar with initial factors of one", () => {
    const w = world();
    const state = createTraffic(w);
    for (const key of ["credits", "capacity"] as const) expect(state[key]).toBeInstanceOf(Float64Array);
    for (const key of ["entries", "waiting", "waited", "lastDemand"] as const) expect(state[key]).toBeInstanceOf(Uint32Array);
    for (const key of ["gridlock", "intersections"] as const) expect(state[key]).toBeInstanceOf(Uint8Array);
    expect(congestionFactors(state)).toEqual(new Float32Array(9).fill(1));
    expect(state.credits).toEqual(new Float64Array(9));
    expect(gridlockCells(state)).toBe(0);
  });

  it.each([
    { power: 1, police: 0, capacity: 1, admissions: 50 },
    { power: 2, police: 0, capacity: 1, admissions: 50 },
    { power: 1, police: 1, capacity: 1, admissions: 50 },
    { power: 2, police: 1, capacity: 1, admissions: 50 },
    { power: 0, police: 0, capacity: 0.5, admissions: 25 },
    { power: 0, police: 1, capacity: 0.8, admissions: 40 },
  ])("admits $admissions cars in 50 busy ticks with power=$power police=$police", ({ power, police, capacity, admissions }) => {
    const w = world();
    w.powered[4] = power;
    w.block[1] = BlockType.Bridge;
    const control = new Uint8Array(9);
    control[4] = police;
    const state = createTraffic(w);
    let total = 0;
    for (let tick = 0; tick < 50; tick++) {
      beginTrafficTick(state, w, control);
      expect(state.capacity[4]).toBe(capacity);
      total += drain(state, 4);
      expect(drain(state, 1)).toBe(2);
      finishTrafficTick(state, w, tick);
    }
    expect(total).toBe(admissions);
  });

  it("carries a half credit into the next dark tick and resets per-tick counters", () => {
    const w = world();
    w.powered[4] = 0;
    const state = createTraffic(w);
    beginTrafficTick(state, w);
    expect(tryEnterTraffic(state, 4)).toBe(false);
    markTrafficWaiting(state, 4);
    finishTrafficTick(state, w, 0);
    expect(state.lastDemand[4]).toBe(1);
    beginTrafficTick(state, w);
    expect(state.waiting[4]).toBe(0);
    expect(tryEnterTraffic(state, 4)).toBe(true);
    expect(tryEnterTraffic(state, 4)).toBe(false);
    expect(state.entries[4]).toBe(1);
    beginTrafficTick(state, w);
    expect(state.entries[4]).toBe(0);
  });

  it("bounds idle credits and clamps existing credit when power fails", () => {
    const w = world();
    const state = createTraffic(w);
    for (let tick = 0; tick < 100; tick++) beginTrafficTick(state, w);
    expect(state.credits[1]).toBe(4);
    expect(state.credits[4]).toBe(2);
    w.powered[4] = 0;
    beginTrafficTick(state, w);
    expect(state.credits[4]).toBe(1);
    expect(drain(state, 4)).toBe(1);
    expect(drain(state, 1)).toBe(4);
  });

  it("only admits roads and bridges, and sees road edits at the next begin", () => {
    const w = world();
    const state = createTraffic(w);
    beginTrafficTick(state, w);
    expect(tryEnterTraffic(state, 0)).toBe(false);
    markTrafficWaiting(state, 0);
    expect(state.waiting[0]).toBe(0);
    w.block[4] = BlockType.Grass;
    beginTrafficTick(state, w);
    expect(tryEnterTraffic(state, 4)).toBe(false);
    expect(state.capacity[4]).toBe(0);
    expect(state.credits[4]).toBe(0);
    expect(state.intersections[4]).toBe(0);
    expect(state.capacity[1]).toBe(2);
  });

  it("detects three cardinal road/bridge neighbours without wrapping rows", () => {
    const w = world(3, 3, [1, 2, 3, 5]);
    const state = createTraffic(w);
    expect(state.intersections[2]).toBe(0); // 3 is in the next row, not east of 2.
    w.block[4] = BlockType.Bridge;
    beginTrafficTick(state, w);
    expect(state.intersections[4]).toBe(1); // north, west, east
    expect(state.intersections[2]).toBe(0);
  });

  it("handles single-column and single-row grids", () => {
    for (const w of [world(1, 3, [0, 1, 2]), world(3, 1, [0, 1, 2])]) {
      const state = createTraffic(w);
      expect(state.intersections).toEqual(new Uint8Array(3));
      beginTrafficTick(state, w);
      expect(Array.from(state.capacity)).toEqual([2, 2, 2]);
    }
  });
});

describe("BPR congestion", () => {
  it("uses previous demand, including queued cars, divided by actual capacity", () => {
    const w = world();
    const state = createTraffic(w);
    beginTrafficTick(state, w);
    expect(tryEnterTraffic(state, 4)).toBe(true);
    markTrafficWaiting(state, 4);
    finishTrafficTick(state, w, 0);
    expect(state.lastDemand[4]).toBe(2);
    expect(congestionFactors(state)[4]).toBe(1);
    beginTrafficTick(state, w);
    expect(congestionFactors(state)[4]).toBe(Math.round(3.4 * 1024) / 1024);
    w.powered[4] = 0;
    beginTrafficTick(state, w);
    expect(congestionFactors(state)[4]).toBe(Math.round(39.4 * 1024) / 1024);
    const police = new Uint8Array(9);
    police[4] = 1;
    beginTrafficTick(state, w, police);
    expect(congestionFactors(state)[4]).toBe(Math.round((1 + 0.15 * 2.5 ** 4) * 1024) / 1024);
  });

  it("is monotone, finite, quantized and clamped even at maximum demand", () => {
    const w = world();
    w.powered[4] = 0;
    const state = createTraffic(w);
    let previous = 1;
    for (const demand of [0, 1, 2, 3, 4, 10, 100, 0xffffffff]) {
      state.lastDemand[4] = demand;
      beginTrafficTick(state, w);
      const factor = congestionFactors(state)[4];
      expect(Number.isFinite(factor)).toBe(true);
      expect(factor).toBeGreaterThanOrEqual(previous);
      expect(factor).toBeLessThanOrEqual(65536);
      expect(factor * 1024).toBe(Math.round(factor * 1024));
      previous = factor;
    }
    expect(previous).toBe(65536);
    expect(congestionFactors(state)[0]).toBe(1);
  });

  it("clears demand and costs after a road is removed", () => {
    const w = world();
    const state = createTraffic(w);
    state.lastDemand[4] = 100;
    w.block[4] = BlockType.Grass;
    beginTrafficTick(state, w);
    expect(congestionFactors(state)[4]).toBe(1);
    expect(state.lastDemand[4]).toBe(0);
  });
});

describe("gridlock episodes", () => {
  it("emits once for two connected sustained queues, clears, and restarts", () => {
    const w = world(3, 1, [0, 1, 2]);
    const state = createTraffic(w);
    const events: SimEvent[] = [];
    for (let tick = 0; tick < 35; tick++) {
      beginTrafficTick(state, w);
      markTrafficWaiting(state, 0);
      markTrafficWaiting(state, 1);
      events.push(...finishTrafficTick(state, w, tick));
      expect(gridlockCells(state)).toBe(tick < 29 ? 0 : 2);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tick: 29, type: "GRIDLOCK", cell: 0, data: { cells: 2 } });
    expect(events[0].reason).toMatch(/30/);
    beginTrafficTick(state, w);
    expect(finishTrafficTick(state, w, 35)).toEqual([]);
    expect(gridlockCells(state)).toBe(0);
    expect(state.waited).toEqual(new Uint32Array(3));
    for (let tick = 36; tick < 66; tick++) {
      beginTrafficTick(state, w);
      markTrafficWaiting(state, 0);
      markTrafficWaiting(state, 1);
      events.push(...finishTrafficTick(state, w, tick));
    }
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ tick: 65, cell: 0, data: { cells: 2 } });
  });

  it("keeps row-edge and diagonal queues in separate deterministic components", () => {
    const w = world(3, 2, [0, 2, 3, 4]);
    const state = createTraffic(w);
    let events: SimEvent[] = [];
    for (let tick = 0; tick < 30; tick++) {
      beginTrafficTick(state, w);
      for (const cell of [0, 2, 3, 4]) markTrafficWaiting(state, cell);
      events = finishTrafficTick(state, w, tick);
    }
    expect(events.map((event) => [event.cell, event.data?.cells])).toEqual([[0, 3], [2, 1]]);
    expect(gridlockCells(state)).toBe(4);
  });

  it("suppresses another event when a sustained component grows or splits", () => {
    const w = world(3, 1, [0, 1, 2]);
    const state = createTraffic(w);
    const events: SimEvent[] = [];
    for (let tick = 0; tick < 31; tick++) {
      beginTrafficTick(state, w);
      for (const cell of tick === 0 ? [0, 1] : [0, 1, 2]) markTrafficWaiting(state, cell);
      events.push(...finishTrafficTick(state, w, tick));
    }
    expect(events).toHaveLength(1);
    expect(gridlockCells(state)).toBe(3);
    beginTrafficTick(state, w);
    markTrafficWaiting(state, 0);
    markTrafficWaiting(state, 2);
    expect(finishTrafficTick(state, w, 31)).toEqual([]);
    expect(gridlockCells(state)).toBe(2);
  });

  it("requires consecutive queued ticks and clears gridlock on road removal", () => {
    const w = world(1, 1, [0]);
    const state = createTraffic(w);
    for (let tick = 0; tick < 60; tick++) {
      beginTrafficTick(state, w);
      if (tick % 30 !== 29) markTrafficWaiting(state, 0);
      expect(finishTrafficTick(state, w, tick)).toEqual([]);
    }
    for (let tick = 60; tick < 90; tick++) {
      beginTrafficTick(state, w);
      markTrafficWaiting(state, 0);
      finishTrafficTick(state, w, tick);
    }
    expect(gridlockCells(state)).toBe(1);
    w.block[0] = BlockType.Grass;
    beginTrafficTick(state, w);
    expect(finishTrafficTick(state, w, 90)).toEqual([]);
    expect(gridlockCells(state)).toBe(0);
  });
});

describe("validation and purity", () => {
  it.each([-1, 9, 0.5, NaN, Infinity, -Infinity])("rejects invalid cell %s without mutation", (cell) => {
    const state = createTraffic(world());
    const before = structuredClone(state);
    expect(() => tryEnterTraffic(state, cell)).toThrow(RangeError);
    expect(() => markTrafficWaiting(state, cell)).toThrow(RangeError);
    expect(state).toEqual(before);
  });

  it("rejects malformed world dimensions and traffic input arrays", () => {
    const valid = world();
    for (const invalid of [
      { ...valid, width: 0 }, { ...valid, height: NaN }, { ...valid, width: 1.5 },
      { ...valid, width: Infinity }, { ...valid, width: 65536, height: 65536 },
      { ...valid, block: new Uint8Array(8) }, { ...valid, powered: new Uint8Array(8) },
      { ...valid, block: new Uint8Array(9).fill(255) },
      { ...valid, powered: new Uint8Array(9).fill(3) },
    ]) {
      expect(() => createTraffic(invalid)).toThrow(RangeError);
      const state = createTraffic(valid);
      const before = structuredClone(state);
      expect(() => beginTrafficTick(state, invalid)).toThrow(RangeError);
      expect(() => finishTrafficTick(state, invalid, 0)).toThrow(RangeError);
      expect(state).toEqual(before);
    }
  });

  it("rejects different world geometry and malformed police masks", () => {
    const w = world();
    const state = createTraffic(w);
    expect(() => beginTrafficTick(state, world(1, 9, [0]))).toThrow(RangeError);
    expect(() => finishTrafficTick(state, world(1, 9, [0]), 0)).toThrow(RangeError);
    expect(() => beginTrafficTick(state, w, new Uint8Array(8))).toThrow(RangeError);
    expect(() => beginTrafficTick(state, w, new Uint8Array(9).fill(2))).toThrow(RangeError);
  });

  it.each([-1, NaN, Infinity, 0.5])("rejects invalid tick %s", (tick) => {
    const w = world();
    const state = createTraffic(w);
    expect(() => finishTrafficTick(state, w, tick)).toThrow(RangeError);
  });

  it("saturates demand counters instead of wrapping", () => {
    const w = world();
    const state = createTraffic(w);
    beginTrafficTick(state, w);
    state.waiting[4] = 0xffffffff;
    markTrafficWaiting(state, 4);
    expect(state.waiting[4]).toBe(0xffffffff);
    expect(tryEnterTraffic(state, 4)).toBe(true);
    finishTrafficTick(state, w, 0);
    expect(state.lastDemand[4]).toBe(0xffffffff);
  });

  it("does not mutate or alias world or police arrays and replays deterministically", () => {
    const w = world();
    w.powered[4] = 0;
    const control = new Uint8Array(9);
    control[4] = 1;
    const before = structuredClone(w);
    const beforeControl = control.slice();
    const run = () => {
      const state = createTraffic(w);
      const events: SimEvent[] = [];
      for (let tick = 0; tick < 65; tick++) {
        beginTrafficTick(state, w, control);
        drain(state, 4);
        markTrafficWaiting(state, 4);
        events.push(...finishTrafficTick(state, w, tick));
        congestionFactors(state);
        gridlockCells(state);
      }
      return { state, events };
    };
    expect(run()).toEqual(run());
    expect(w).toEqual(before);
    expect(control).toEqual(beforeControl);
  });
});
