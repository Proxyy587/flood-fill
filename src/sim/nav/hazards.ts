import { BlockType, type Scenario } from "../../contracts/types";
import type { World } from "../world/grid";
import type { NavGrid } from "./index";

export type TravelMode = "foot" | "car" | "emergency" | "boat";

const CAR_LIMIT = Math.fround(0.3);
const WALK_LIMIT = Math.fround(0.5);
const BOAT_DRAFT = Math.fround(0.6);
const MAX_COST = 65536;
const COST_SCALE = 1024;

/** Shape checks are constant-time, including when checking each entered cell. */
function validateWorld(world: World): number {
  const { width, height } = world;
  if (!Number.isInteger(width) || width < 1 || width > 128 ||
      !Number.isInteger(height) || height < 1 || height > 128) {
    throw new RangeError("Hazard dimensions must be integers in [1,128]");
  }
  const count = width * height;
  if (!(world.ground instanceof Uint8Array) || world.ground.length !== count ||
      !(world.block instanceof Uint8Array) || world.block.length !== count ||
      !(world.buildingId instanceof Int32Array) || world.buildingId.length !== count ||
      !(world.water instanceof Float32Array) || world.water.length !== count ||
      !(world.flow instanceof Float32Array) || world.flow.length !== count * 4 ||
      !(world.powered instanceof Uint8Array) || world.powered.length !== count ||
      !(world.barrier instanceof Float32Array) || world.barrier.length !== count ||
      !(world.scratch instanceof Float64Array) || world.scratch.length !== count ||
      !(world.bridgeDeck instanceof Float32Array) || world.bridgeDeck.length !== count) {
    throw new RangeError("Hazard World arrays must have their declared types and grid lengths");
  }
  return count;
}

function validateInputs(world: World, scenario: Scenario, mode: TravelMode, blocked?: Uint8Array): number {
  const count = validateWorld(world);
  if (scenario.size.w !== world.width || scenario.size.h !== world.height ||
      !Array.isArray(scenario.ground) || scenario.ground.length !== count ||
      !Array.isArray(scenario.blocks) || scenario.blocks.length !== count) {
    throw new RangeError("Hazard scenario dimensions and terrain lengths must match World");
  }
  if (mode !== "foot" && mode !== "car" && mode !== "emergency" && mode !== "boat") {
    throw new RangeError("Unknown hazard travel mode");
  }
  if (blocked !== undefined && (!(blocked instanceof Uint8Array) || blocked.length !== count)) {
    throw new RangeError("Hazard blocked mask must be a grid-sized Uint8Array");
  }
  return count;
}

function validateCell(cell: number, count: number): void {
  if (!Number.isInteger(cell) || cell < 0 || cell >= count) {
    throw new RangeError("Hazard cell must be an integer within the grid");
  }
}

/** Depth above the bridge deck, or above terrain for every other cell. */
function depthAt(world: World, cell: number): number {
  const water = world.water[cell];
  if (!Number.isFinite(water) || water < 0) {
    throw new RangeError("Hazard water depth must be finite and nonnegative");
  }
  if (world.block[cell] > BlockType.Levee) {
    throw new RangeError("Unknown hazard block type");
  }
  if (world.block[cell] !== BlockType.Bridge) return water;
  const deck = world.bridgeDeck[cell];
  if (!Number.isFinite(deck)) throw new RangeError("Hazard bridge deck must be finite");
  return Math.max(0, world.ground[cell] + water - deck);
}

function enterAt(world: World, mode: TravelMode, cell: number, depth: number, entrance: boolean, blocked?: Uint8Array): boolean {
  if (blocked !== undefined && blocked[cell] !== 0) return false;
  const block = world.block[cell];
  const building = world.buildingId[cell] !== 0 ||
    (block >= BlockType.House && block <= BlockType.Substation);
  if (block === BlockType.Tree || block === BlockType.Levee) return false;
  if (building && (mode !== "foot" || !entrance)) return false;

  if (mode === "boat") {
    // The 2.5D graph has one node per cell: it cannot represent an underpass
    // separately from the bridge road deck. Boats therefore never enter bridges.
    return block !== BlockType.Bridge && depth >= BOAT_DRAFT;
  }
  if (block === BlockType.Bridge &&
      (world.bridgeDeck[cell] <= world.ground[cell] ||
       world.ground[cell] + world.water[cell] >= world.bridgeDeck[cell])) return false;
  if (mode === "foot") return block !== BlockType.WaterSource && depth <= WALK_LIMIT;
  return (block === BlockType.Road || block === BlockType.Bridge) &&
    depth <= (mode === "car" ? CAR_LIMIT : WALK_LIMIT);
}

/**
 * Owned navigation arrays for the current world; no input is mutated or cached.
 * Scenario is already schema-validated at world creation; shapes are rechecked.
 * Foot wading above 0.3m costs 2x; car costs use the supplied congestion factor.
 * Every cell, including blocked cells, has a positive quantized bounded cost.
 */
export function buildHazardGrid(
  world: World,
  scenario: Scenario,
  mode: TravelMode,
  blocked?: Uint8Array,
  congestion?: Float32Array,
): NavGrid {
  const count = validateInputs(world, scenario, mode, blocked);
  if (congestion !== undefined && (!(congestion instanceof Float32Array) || congestion.length !== count)) {
    throw new RangeError("Hazard congestion must be a grid-sized Float32Array");
  }
  const entrances = new Uint8Array(count);
  if (mode === "foot") {
    for (const building of scenario.buildings) {
      validateCell(building.entrance, count);
      if (world.buildingId[building.entrance] === building.id) entrances[building.entrance] = 1;
    }
  }
  const passable = new Uint8Array(count);
  const costs = new Float32Array(count);
  for (let cell = 0; cell < count; cell++) {
    const factor = congestion?.[cell] ?? 1;
    // Validate supplied factors even when this mode or cell does not use them.
    if (!Number.isFinite(factor) || factor < 1 || factor > MAX_COST) {
      throw new RangeError("Hazard congestion factors must be finite within [1,65536]");
    }
    const depth = depthAt(world, cell);
    passable[cell] = Number(enterAt(world, mode, cell, depth, entrances[cell] !== 0, blocked));
    const cost = mode === "foot" && depth > CAR_LIMIT ? 2 : mode === "car" ? factor : 1;
    costs[cell] = Math.min(MAX_COST, Math.max(1 / COST_SCALE, Math.round(cost * COST_SCALE) / COST_SCALE));
  }
  return { width: world.width, height: world.height, passable, costs };
}

/** Check the next entered cell against live hazards; malformed inputs throw RangeError. */
export function canEnter(
  world: World,
  scenario: Scenario,
  mode: TravelMode,
  cell: number,
  blocked?: Uint8Array,
): boolean {
  const count = validateInputs(world, scenario, mode, blocked);
  validateCell(cell, count);
  const depth = depthAt(world, cell);
  const entrance = mode === "foot" && world.buildingId[cell] !== 0 && scenario.buildings.some((building) =>
    building.entrance === cell && building.id === world.buildingId[cell]);
  return enterAt(world, mode, cell, depth, entrance, blocked);
}

/** Actual road/deck water depth in metres; malformed worlds/cells throw RangeError. */
export function roadDepth(world: World, cell: number): number {
  const count = validateWorld(world);
  validateCell(cell, count);
  return depthAt(world, cell);
}
