import { BlockType, type SimEvent } from "../../contracts/types";
import type { World } from "../world/grid";

const MAX_COUNT = 0xffffffff;
const GRIDLOCK_TICKS = 30;
const COST_SCALE = 1024;
const MAX_FACTOR = 65536;
// Only absorbs floating-point roundoff from repeated 0.8-credit additions.
const CREDIT_EPSILON = 1e-12;

/** Owned sidecar arrays. No population, vehicle occupancy or headway model. */
export interface TrafficState {
  readonly width: number;
  readonly height: number;
  credits: Float64Array;
  capacity: Float64Array;
  entries: Uint32Array;
  waiting: Uint32Array;
  waited: Uint32Array;
  gridlock: Uint8Array;
  intersections: Uint8Array;
  lastDemand: Uint32Array;
  factors: Float32Array;
  /** Road topology as of createTraffic / the most recent beginTrafficTick. */
  roads: Uint8Array;
  /** Reusable component traversal storage; consumers must not modify it. */
  previousGridlock: Uint8Array;
  visited: Uint8Array;
  queue: Uint32Array;
}

function validateWorld(world: World, state?: TrafficState): number {
  const size = world.width * world.height;
  if (!Number.isSafeInteger(world.width) || world.width < 1 ||
      !Number.isSafeInteger(world.height) || world.height < 1 ||
      !Number.isSafeInteger(size) || size > MAX_COUNT ||
      world.block.length !== size || world.powered.length !== size ||
      (state && (state.width !== world.width || state.height !== world.height))) {
    throw new RangeError("Invalid traffic world dimensions or array lengths");
  }
  for (let cell = 0; cell < size; cell++) {
    if (world.block[cell] > BlockType.Levee || world.powered[cell] > 2) {
      throw new RangeError("Invalid traffic block or power value");
    }
  }
  return size;
}

function validateCell(state: TrafficState, cell: number): void {
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.roads.length) {
    throw new RangeError("Invalid traffic cell");
  }
}

function refreshTopology(state: TrafficState, world: World, policeControlled?: Uint8Array): void {
  const { width, height } = world;
  const size = state.roads.length;
  for (let cell = 0; cell < size; cell++) {
    state.roads[cell] = Number(world.block[cell] === BlockType.Road || world.block[cell] === BlockType.Bridge);
  }
  for (let cell = 0; cell < size; cell++) {
    if (state.roads[cell] === 0) {
      state.intersections[cell] = 0;
      state.capacity[cell] = 0;
      state.credits[cell] = 0;
      state.lastDemand[cell] = 0;
      state.waited[cell] = 0;
      state.gridlock[cell] = 0;
      continue;
    }
    const x = cell % width;
    const z = Math.floor(cell / width);
    let neighbours = 0;
    if (z > 0) neighbours += state.roads[cell - width];
    if (x + 1 < width) neighbours += state.roads[cell + 1];
    if (z + 1 < height) neighbours += state.roads[cell + width];
    if (x > 0) neighbours += state.roads[cell - 1];
    const intersection = neighbours >= 3;
    state.intersections[cell] = Number(intersection);
    state.capacity[cell] = !intersection ? 2 : world.powered[cell] > 0 ? 1 :
      policeControlled?.[cell] === 1 ? 0.8 : 0.5;
  }
}

/** Detects roads/intersections without granting a tick's admission credits. */
export function createTraffic(world: World): TrafficState {
  const size = validateWorld(world);
  const state: TrafficState = {
    width: world.width, height: world.height,
    credits: new Float64Array(size), capacity: new Float64Array(size),
    entries: new Uint32Array(size), waiting: new Uint32Array(size),
    waited: new Uint32Array(size), gridlock: new Uint8Array(size),
    intersections: new Uint8Array(size), lastDemand: new Uint32Array(size),
    factors: new Float32Array(size).fill(1),
    roads: new Uint8Array(size), previousGridlock: new Uint8Array(size),
    visited: new Uint8Array(size), queue: new Uint32Array(size),
  };
  refreshTopology(state, world);
  return state;
}

/**
 * Call once per simulated second, before admissions. Routing reads the previous
 * tick's demand using this tick's actual capacity. Credits may bank up to two
 * seconds of throughput, with a minimum ceiling of one for dark intersections.
 */
export function beginTrafficTick(state: TrafficState, world: World, policeControlled?: Uint8Array): void {
  const size = validateWorld(world, state);
  if (policeControlled && (policeControlled.length !== size || policeControlled.some((value) => value > 1))) {
    throw new RangeError("Police control must be a binary mask matching the traffic grid");
  }
  state.entries.fill(0);
  state.waiting.fill(0);
  refreshTopology(state, world, policeControlled);
  for (let cell = 0; cell < size; cell++) {
    const capacity = state.capacity[cell];
    if (capacity === 0) {
      state.factors[cell] = 1;
      continue;
    }
    state.credits[cell] = Math.min(Math.max(1, 2 * capacity), state.credits[cell] + capacity);
    const ratio = state.lastDemand[cell] / capacity;
    const factor = Math.min(MAX_FACTOR, 1 + 0.15 * ratio ** 4);
    state.factors[cell] = Math.round(factor * COST_SCALE) / COST_SCALE;
  }
}

/**
 * Consumes one throughput credit. Caller supplies stable rotating agent order
 * and checks hazard passability separately. Failed admission does not enqueue;
 * call markTrafficWaiting once for each car still queued at the end of movement.
 * Invalid indices throw; valid non-road cells return false.
 */
export function tryEnterTraffic(state: TrafficState, cell: number): boolean {
  validateCell(state, cell);
  if (state.roads[cell] === 0 || state.credits[cell] < 1 - CREDIT_EPSILON) return false;
  state.credits[cell] = Math.max(0, state.credits[cell] - 1);
  state.entries[cell] = Math.min(MAX_COUNT, state.entries[cell] + 1);
  return true;
}

export function markTrafficWaiting(state: TrafficState, cell: number): void {
  validateCell(state, cell);
  if (state.roads[cell]) state.waiting[cell] = Math.min(MAX_COUNT, state.waiting[cell] + 1);
}

function enqueue(state: TrafficState, cell: number, tail: number): number {
  if (state.gridlock[cell] && !state.visited[cell]) {
    state.visited[cell] = 1;
    state.queue[tail++] = cell;
  }
  return tail;
}

/**
 * Records demand and consecutive queued ticks. Each cardinal component of cells
 * queued for >=30 ticks emits once. Growth, merging and splitting retain an
 * episode when any member was already gridlocked; draining clears that cell.
 * data.cells is the component size, consistent with existing blackout events.
 */
export function finishTrafficTick(state: TrafficState, world: World, tick: number): SimEvent[] {
  const size = validateWorld(world, state);
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError("Invalid traffic tick");
  state.previousGridlock.set(state.gridlock);
  state.visited.fill(0);
  for (let cell = 0; cell < size; cell++) {
    state.lastDemand[cell] = Math.min(MAX_COUNT, state.entries[cell] + state.waiting[cell]);
    state.waited[cell] = state.roads[cell] && state.waiting[cell] > 0 ?
      Math.min(MAX_COUNT, state.waited[cell] + 1) : 0;
    state.gridlock[cell] = Number(state.waited[cell] >= GRIDLOCK_TICKS);
  }
  const events: SimEvent[] = [];
  for (let start = 0; start < size; start++) {
    if (!state.gridlock[start] || state.visited[start]) continue;
    let head = 0;
    let tail = enqueue(state, start, 0);
    let continuing = false;
    while (head < tail) {
      const cell = state.queue[head++];
      if (state.previousGridlock[cell]) continuing = true;
      const x = cell % state.width;
      const z = Math.floor(cell / state.width);
      if (z > 0) tail = enqueue(state, cell - state.width, tail);
      if (x + 1 < state.width) tail = enqueue(state, cell + 1, tail);
      if (z + 1 < state.height) tail = enqueue(state, cell + state.width, tail);
      if (x > 0) tail = enqueue(state, cell - 1, tail);
    }
    if (!continuing) events.push({
      tick, type: "GRIDLOCK", cell: start, data: { cells: tail },
      reason: `${tail} connected road cells have queued traffic for at least ${GRIDLOCK_TICKS} consecutive ticks`,
    });
  }
  return events;
}

/** Owned, stable factor buffer; routing consumers must treat it as read-only. */
export function congestionFactors(state: TrafficState): Float32Array { return state.factors; }

export function gridlockCells(state: TrafficState): number {
  let count = 0;
  for (let cell = 0; cell < state.gridlock.length; cell++) count += state.gridlock[cell];
  return count;
}
