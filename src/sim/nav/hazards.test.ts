import { describe, expect, it } from "vitest";
import { mockScenario } from "../../contracts/mocks";
import { BlockType } from "../../contracts/types";
import { createWorld, type World } from "../world/grid";
import { buildHazardGrid, canEnter, roadDepth, type TravelMode } from "./hazards";
import { buildFlowField, findPath } from "./index";

const modes: TravelMode[] = ["foot", "car", "emergency", "boat"];

function fixture() {
  const scenario = mockScenario();
  scenario.buildings[0].cells.push(10);
  scenario.blocks[10] = BlockType.House;
  return { scenario, world: createWorld(scenario) };
}

/** Adjacent representable positive Float32 depths, rather than decimal epsilons. */
function adjacent(value: number, direction: -1 | 1): number {
  const floats = new Float32Array([value]);
  const bits = new Uint32Array(floats.buffer);
  bits[0] += direction;
  return floats[0];
}

describe("hazard depth thresholds", () => {
  it.each([
    { mode: "car", limit: Math.fround(0.3), minimum: false },
    { mode: "emergency", limit: Math.fround(0.5), minimum: false },
    { mode: "foot", limit: Math.fround(0.5), minimum: false },
    { mode: "boat", limit: Math.fround(0.6), minimum: true },
  ] as const)("uses an inclusive Float32 threshold for $mode", ({ mode, limit, minimum }) => {
    const { scenario, world } = fixture();
    for (const [depth, expected] of [
      [adjacent(limit, -1), !minimum], [limit, true], [adjacent(limit, 1), minimum],
    ] as const) {
      world.water[24] = depth;
      expect(canEnter(world, scenario, mode, 24)).toBe(expected);
      expect(buildHazardGrid(world, scenario, mode).passable[24]).toBe(Number(expected));
    }
  });

  it("adds a walking slowdown strictly above 0.3m through the 0.5m limit", () => {
    const { scenario, world } = fixture();
    const threshold = Math.fround(0.3);
    for (const depth of [adjacent(threshold, -1), threshold]) {
      world.water[0] = depth;
      expect(buildHazardGrid(world, scenario, "foot").costs?.[0]).toBe(1);
    }
    for (const depth of [adjacent(threshold, 1), Math.fround(0.5)]) {
      world.water[0] = depth;
      const grid = buildHazardGrid(world, scenario, "foot");
      expect(grid.passable[0]).toBe(1);
      expect(grid.costs?.[0]).toBe(2);
    }
  });

  it("keeps ordinary road depth independent of terrain elevation", () => {
    const { scenario, world } = fixture();
    world.ground[24] = 255;
    world.water[24] = Math.fround(0.3);
    expect(roadDepth(world, 24)).toBe(world.water[24]);
    expect(canEnter(world, scenario, "car", 24)).toBe(true);
  });
});

describe("terrain and buildings", () => {
  it.each([BlockType.Grass, BlockType.Dirt, BlockType.Sand, BlockType.Rock,
    BlockType.Road, BlockType.Drainage, BlockType.Pole])("allows foot travel on terrain %i", (block) => {
    const { scenario, world } = fixture();
    world.block[0] = block;
    expect(canEnter(world, scenario, "foot", 0)).toBe(true);
  });

  it.each(["car", "emergency"] as const)("restricts %s to roads and bridges", (mode) => {
    const { scenario, world } = fixture();
    for (let block = BlockType.Grass; block <= BlockType.Levee; block++) {
      world.block[0] = block;
      world.bridgeDeck[0] = 1;
      expect(canEnter(world, scenario, mode, 0)).toBe(block === BlockType.Road || block === BlockType.Bridge);
    }
  });

  it.each([BlockType.Tree, BlockType.Levee, BlockType.WaterSource])("blocks foot travel on obstacle %i", (block) => {
    const { scenario, world } = fixture();
    world.block[0] = block;
    expect(canEnter(world, scenario, "foot", 0)).toBe(false);
  });

  it("allows only the matching building entrance for foot travel", () => {
    const { scenario, world } = fixture();
    expect(canEnter(world, scenario, "foot", 9)).toBe(true);
    expect(canEnter(world, scenario, "foot", 10)).toBe(false);
    world.water[9] = 0.5;
    expect(canEnter(world, scenario, "foot", 9)).toBe(true);
    world.water[9] = adjacent(0.5, 1);
    expect(canEnter(world, scenario, "foot", 9)).toBe(false);
    world.water[9] = 0;
    world.buildingId[9] = 2;
    expect(canEnter(world, scenario, "foot", 9)).toBe(false);
    world.block[10] = BlockType.Grass;
    expect(canEnter(world, scenario, "foot", 10)).toBe(false);
  });

  it("blocks solid building types without a matching entrance", () => {
    const { scenario, world } = fixture();
    for (let block = BlockType.House; block <= BlockType.Substation; block++) {
      world.block[0] = block;
      world.water[0] = 1;
      expect(canEnter(world, scenario, "boat", 0)).toBe(false);
      world.water[0] = 0;
      expect(canEnter(world, scenario, "foot", 0)).toBe(false);
    }
  });

  it("allows boats in deep open water and flooded terrain, never obstacles or entrances", () => {
    const { scenario, world } = fixture();
    world.water.fill(Math.fround(0.6));
    for (const block of [BlockType.Grass, BlockType.Rock, BlockType.Road, BlockType.WaterSource]) {
      world.block[0] = block;
      expect(canEnter(world, scenario, "boat", 0)).toBe(true);
    }
    for (const block of [BlockType.Tree, BlockType.Levee]) {
      world.block[0] = block;
      expect(canEnter(world, scenario, "boat", 0)).toBe(false);
    }
    expect(canEnter(world, scenario, "boat", 9)).toBe(false);
    expect(canEnter(world, scenario, "boat", 10)).toBe(false);
  });
});

describe("bridge decks in the single-layer graph", () => {
  it.each([undefined, 6])("uses actual deck height (override %s) above terrain", (deckHeight) => {
    const scenario = mockScenario();
    scenario.ground[24] = 4;
    scenario.blocks[24] = BlockType.Bridge;
    if (deckHeight !== undefined) scenario.bridges = [{ cell: 24, deckHeight }];
    const world = createWorld(scenario);
    const clearance = (deckHeight ?? 5) - 4;
    for (const depth of [0, adjacent(clearance, -1), clearance, adjacent(clearance, 1), clearance + 0.5]) {
      world.water[24] = depth;
      expect(roadDepth(world, 24)).toBe(Math.max(0, 4 + depth - (deckHeight ?? 5)));
      for (const mode of ["foot", "car", "emergency"] as const) {
        expect(canEnter(world, scenario, mode, 24)).toBe(depth < clearance);
        expect(buildHazardGrid(world, scenario, mode).passable[24]).toBe(Number(depth < clearance));
      }
      expect(canEnter(world, scenario, "boat", 24)).toBe(false);
      expect(buildHazardGrid(world, scenario, "foot").costs?.[24]).toBe(depth - clearance > Math.fround(0.3) ? 2 : 1);
    }
  });

  it.each([0, -1])("rejects a dry bridge whose deck is not above terrain (%i)", (offset) => {
    const { scenario, world } = fixture();
    world.block[24] = BlockType.Bridge;
    world.ground[24] = 4;
    world.bridgeDeck[24] = 4 + offset;
    for (const mode of modes) expect(canEnter(world, scenario, mode, 24)).toBe(false);
  });
});

describe("grid construction and costs", () => {
  it.each(modes)("applies all nonzero blocked values to %s", (mode) => {
    const { scenario, world } = fixture();
    world.water[24] = mode === "boat" ? Math.fround(0.6) : 0;
    const blocked = new Uint8Array(64);
    expect(canEnter(world, scenario, mode, 24, blocked)).toBe(true);
    blocked[24] = 255;
    expect(canEnter(world, scenario, mode, 24, blocked)).toBe(false);
    expect(buildHazardGrid(world, scenario, mode, blocked).passable[24]).toBe(0);
  });

  it.each(modes)("matches per-cell checks without row-boundary dependence for %s", (mode) => {
    const { scenario, world } = fixture();
    const blocked = new Uint8Array(64);
    world.block.fill(BlockType.Road);
    world.buildingId.fill(0);
    for (let cell = 0; cell < 64; cell++) {
      world.water[cell] = [0, Math.fround(0.3), 0.5, Math.fround(0.6)][cell % 4];
      blocked[cell] = Number(cell % 7 === 0);
    }
    const grid = buildHazardGrid(world, scenario, mode, blocked);
    expect([grid.width, grid.height]).toEqual([8, 8]);
    for (let cell = 0; cell < 64; cell++) {
      const depth = world.water[cell];
      const safe = mode === "boat" ? depth >= Math.fround(0.6) : depth <= (mode === "car" ? Math.fround(0.3) : 0.5);
      expect(grid.passable[cell]).toBe(Number(safe && blocked[cell] === 0));
      expect(grid.passable[cell]).toBe(Number(canEnter(world, scenario, mode, cell, blocked)));
    }
  });

  it("does not turn consecutive row-edge cells into adjacent destinations", () => {
    const { scenario, world } = fixture();
    const blocked = new Uint8Array(64).fill(1);
    blocked[7] = 0;
    blocked[8] = 0;
    const grid = buildHazardGrid(world, scenario, "foot", blocked);
    expect(Array.from(grid.passable).filter(Boolean)).toHaveLength(2);
    expect(findPath(grid, 7, 8)).toBeNull();
    expect(buildFlowField(grid, [8]).next[7]).toBe(-1);
  });

  it.each(modes)("produces owned finite quantized nav costs including blocked cells for %s", (mode) => {
    const { scenario, world } = fixture();
    world.water.fill(0.4);
    const blocked = new Uint8Array(64);
    blocked[0] = 1;
    const congestion = new Float32Array(64).fill(1);
    congestion[0] = 65536;
    congestion[24] = 1.23456;
    congestion[25] = 65536;
    const before = structuredClone({ world, scenario, blocked, congestion });
    const grid = buildHazardGrid(world, scenario, mode, blocked, congestion);
    const second = buildHazardGrid(world, scenario, mode, blocked, congestion);
    expect(grid).toEqual(second);
    expect(grid.passable).not.toBe(second.passable);
    expect(grid.costs).not.toBe(second.costs);
    expect(grid.costs).toBeInstanceOf(Float32Array);
    for (const cost of grid.costs ?? []) {
      expect(Number.isFinite(cost)).toBe(true);
      expect(cost).toBeGreaterThanOrEqual(1 / 1024);
      expect(cost).toBeLessThanOrEqual(65536);
      expect(Number.isInteger(cost * 1024)).toBe(true);
    }
    expect(grid.costs?.[24]).toBe(mode === "car" ? Math.round(congestion[24] * 1024) / 1024 : mode === "foot" ? 2 : 1);
    expect(grid.costs?.[25]).toBe(mode === "car" ? 65536 : mode === "foot" ? 2 : 1);
    expect(() => findPath(grid, 0, 63)).not.toThrow();
    expect(() => buildFlowField(grid, [0, 63])).not.toThrow();
    expect({ world, scenario, blocked, congestion }).toEqual(before);
    grid.passable.fill(0);
    grid.costs?.fill(1);
    expect({ world, scenario, blocked, congestion }).toEqual(before);
  });
});

describe("hazard validation", () => {
  it.each([-1, 64, 0.5, NaN, Infinity])("throws RangeError for invalid cell %s", (cell) => {
    const { scenario, world } = fixture();
    expect(() => canEnter(world, scenario, "foot", cell)).toThrow(RangeError);
    expect(() => roadDepth(world, cell)).toThrow(RangeError);
  });

  it.each([0, -1, 1.5, 129, NaN, Infinity])("rejects invalid dimensions %s", (dimension) => {
    const { scenario, world } = fixture();
    for (const key of ["width", "height"] as const) {
      const malformed = { ...world, [key]: dimension };
      expect(() => buildHazardGrid(malformed, scenario, "foot")).toThrow(RangeError);
      expect(() => canEnter(malformed, scenario, "foot", 0)).toThrow(RangeError);
      expect(() => roadDepth(malformed, 0)).toThrow(RangeError);
    }
  });

  it.each(["ground", "block", "buildingId", "water", "flow", "powered", "barrier", "scratch", "bridgeDeck"] as const)("rejects malformed World.%s lengths", (key) => {
    const { scenario, world } = fixture();
    const malformed = { ...world, [key]: world[key].slice(1) };
    expect(() => buildHazardGrid(malformed, scenario, "foot")).toThrow(RangeError);
    expect(() => canEnter(malformed, scenario, "foot", 0)).toThrow(RangeError);
    expect(() => roadDepth(malformed, 0)).toThrow(RangeError);
  });

  it("rejects mismatched scenario dimensions and terrain array lengths", () => {
    const { scenario, world } = fixture();
    for (const malformed of [
      { ...scenario, size: { w: 4, h: 16 } },
      { ...scenario, ground: [] }, { ...scenario, blocks: [] },
    ]) {
      expect(() => buildHazardGrid(world, malformed, "foot")).toThrow(RangeError);
      expect(() => canEnter(world, malformed, "foot", 0)).toThrow(RangeError);
    }
  });

  it("rejects incorrect typed-array inputs and optional array lengths", () => {
    const { scenario, world } = fixture();
    const malformed = { ...world, water: new Float64Array(64) } as unknown as World;
    expect(() => buildHazardGrid(malformed, scenario, "foot")).toThrow(RangeError);
    for (const blocked of [new Uint8Array(63), new Float32Array(64) as unknown as Uint8Array]) {
      expect(() => buildHazardGrid(world, scenario, "foot", blocked)).toThrow(RangeError);
      expect(() => canEnter(world, scenario, "foot", 0, blocked)).toThrow(RangeError);
    }
    for (const congestion of [new Float32Array(63), new Float64Array(64).fill(1) as unknown as Float32Array]) {
      expect(() => buildHazardGrid(world, scenario, "foot", undefined, congestion)).toThrow(RangeError);
    }
  });

  it.each([0, -1, 0.999, NaN, Infinity, 65537])("rejects invalid congestion %s even on blocked or unused modes", (factor) => {
    const { scenario, world } = fixture();
    const congestion = new Float32Array(64).fill(1);
    congestion[63] = factor;
    for (const mode of modes) {
      expect(() => buildHazardGrid(world, scenario, mode, new Uint8Array(64).fill(1), congestion)).toThrow(RangeError);
    }
  });

  it.each([-1, NaN, Infinity])("rejects invalid water depth %s", (depth) => {
    const { scenario, world } = fixture();
    world.water[0] = depth;
    expect(() => roadDepth(world, 0)).toThrow(RangeError);
    for (const mode of modes) {
      expect(() => canEnter(world, scenario, mode, 0)).toThrow(RangeError);
      expect(() => buildHazardGrid(world, scenario, mode, new Uint8Array(64).fill(1))).toThrow(RangeError);
    }
  });

  it("rejects nonfinite bridge decks and unknown travel modes", () => {
    const { scenario, world } = fixture();
    world.block[24] = BlockType.Bridge;
    world.bridgeDeck[24] = NaN;
    expect(() => roadDepth(world, 24)).toThrow(RangeError);
    expect(() => canEnter(world, scenario, "foot", 24)).toThrow(RangeError);
    expect(() => buildHazardGrid(world, scenario, "boat")).toThrow(RangeError);
    expect(() => canEnter(world, scenario, "air" as TravelMode, 0)).toThrow(RangeError);
    expect(() => buildHazardGrid(world, scenario, "air" as TravelMode)).toThrow(RangeError);
  });
});
