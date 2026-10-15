/** Internal navigation input; indices use z * width + x and nonzero means passable. */
export interface NavGrid {
  width: number;
  height: number;
  passable: Uint8Array;
  /** Entering cost, in 1/1024 units within [1/1024,65536]; default one. */
  costs?: Float32Array;
}

/** Binary min-heap ordered by priority, cell index, then distance. */
class MinHeap {
  private cells = new Int32Array(64);
  private distances = new Float64Array(64);
  private priorities = new Float64Array(64);
  size = 0;

  get cell(): number { return this.cells[0]; }
  get distance(): number { return this.distances[0]; }

  push(cell: number, distance: number, priority: number): void {
    if (this.size === this.cells.length) {
      const capacity = this.size * 2;
      const cells = new Int32Array(capacity);
      const distances = new Float64Array(capacity);
      const priorities = new Float64Array(capacity);
      cells.set(this.cells);
      distances.set(this.distances);
      priorities.set(this.priorities);
      this.cells = cells;
      this.distances = distances;
      this.priorities = priorities;
    }
    let slot = this.size++;
    this.cells[slot] = cell;
    this.distances[slot] = distance;
    this.priorities[slot] = priority;
    while (slot > 0) {
      const parent = Math.floor((slot - 1) / 2);
      if (!this.less(slot, parent)) break;
      this.swap(slot, parent);
      slot = parent;
    }
  }

  pop(): void {
    this.size--;
    if (this.size === 0) return;
    this.cells[0] = this.cells[this.size];
    this.distances[0] = this.distances[this.size];
    this.priorities[0] = this.priorities[this.size];
    let slot = 0;
    while (slot * 2 + 1 < this.size) {
      let child = slot * 2 + 1;
      if (child + 1 < this.size && this.less(child + 1, child)) child++;
      if (!this.less(child, slot)) break;
      this.swap(slot, child);
      slot = child;
    }
  }

  private less(a: number, b: number): boolean {
    if (this.priorities[a] !== this.priorities[b]) {
      return this.priorities[a] < this.priorities[b];
    }
    if (this.cells[a] !== this.cells[b]) return this.cells[a] < this.cells[b];
    return this.distances[a] < this.distances[b];
  }

  private swap(a: number, b: number): void {
    const cell = this.cells[a];
    const distance = this.distances[a];
    const priority = this.priorities[a];
    this.cells[a] = this.cells[b];
    this.distances[a] = this.distances[b];
    this.priorities[a] = this.priorities[b];
    this.cells[b] = cell;
    this.distances[b] = distance;
    this.priorities[b] = priority;
  }
}

/** Validate before searching, including costs on blocked cells. */
function validateGrid(grid: NavGrid): number {
  const { width, height, passable, costs } = grid;
  const count = width * height;
  if (!Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0 ||
      width > 128 || height > 128 || !Number.isSafeInteger(count)) {
    throw new RangeError("Navigation dimensions must be integers in [1,128]");
  }
  if (!(passable instanceof Uint8Array) || passable.length !== count) {
    throw new RangeError("Navigation passable length must match width * height");
  }
  if (costs === undefined) return 1;
  if (!(costs instanceof Float32Array) || costs.length !== count) {
    throw new RangeError("Navigation costs length must match width * height");
  }
  let minimum = Infinity;
  for (let cell = 0; cell < count; cell++) {
    const cost = costs[cell];
    if (!Number.isFinite(cost) || cost < 1 / 1024 || cost > 65536 || !Number.isInteger(cost * 1024)) {
      throw new RangeError("Navigation costs must use 1/1024 units within [1/1024,65536]");
    }
    if (passable[cell] !== 0 && cost < minimum) minimum = cost;
  }
  return minimum === Infinity ? 1 : minimum;
}

function validateIndex(index: number, count: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError("Navigation cell index must be an integer within the grid");
  }
}

/** Writes adjacent cells in ascending index order, without crossing row edges. */
function neighbors(grid: NavGrid, cell: number, output: Int32Array): number {
  const x = cell % grid.width;
  let count = 0;
  if (cell >= grid.width) output[count++] = cell - grid.width;
  if (x > 0) output[count++] = cell - 1;
  if (x + 1 < grid.width) output[count++] = cell + 1;
  if (cell + grid.width < grid.passable.length) output[count++] = cell + grid.width;
  return count;
}

/**
 * Deterministic four-connected A*. Returns both endpoints, or null when blocked
 * or unreachable. Malformed grids and invalid indices throw RangeError.
 */
export function findPath(grid: NavGrid, start: number, goal: number): number[] | null {
  const minimumCost = validateGrid(grid);
  const count = grid.passable.length;
  validateIndex(start, count);
  validateIndex(goal, count);
  if (grid.passable[start] === 0 || grid.passable[goal] === 0) return null;

  const distance = new Float64Array(count).fill(Infinity);
  const parent = new Int32Array(count).fill(-1);
  const adjacent = new Int32Array(4);
  const heap = new MinHeap();
  const goalX = goal % grid.width;
  const goalZ = Math.floor(goal / grid.width);
  const heuristic = (cell: number): number => minimumCost * (
    Math.abs(cell % grid.width - goalX) +
    Math.abs(Math.floor(cell / grid.width) - goalZ)
  );
  distance[start] = 0;
  heap.push(start, 0, heuristic(start));

  while (heap.size > 0) {
    const cell = heap.cell;
    const travelled = heap.distance;
    heap.pop();
    if (travelled !== distance[cell]) continue;
    if (cell === goal) {
      const path: number[] = [];
      for (let step = goal; step !== -1; step = parent[step]) path.push(step);
      return path.reverse();
    }
    const length = neighbors(grid, cell, adjacent);
    for (let n = 0; n < length; n++) {
      const neighbor = adjacent[n];
      if (grid.passable[neighbor] === 0) continue;
      const candidate = travelled + (grid.costs?.[neighbor] ?? 1);
      if (candidate >= distance[neighbor]) continue;
      distance[neighbor] = candidate;
      parent[neighbor] = cell;
      heap.push(neighbor, candidate, candidate + heuristic(neighbor));
    }
  }
  return null;
}

/**
 * Reverse multi-source Dijkstra for the same entering-cell costs as findPath.
 * Blocked targets are ignored; empty targets produce an unreachable field.
 * Targets point to themselves. Unreachable cells have Infinity distance and -1
 * next. Invalid targets or malformed grids throw RangeError. Inputs are read only.
 */
export function buildFlowField(
  grid: NavGrid,
  targets: readonly number[],
): { distance: Float64Array; next: Int32Array } {
  validateGrid(grid);
  const count = grid.passable.length;
  for (const target of targets) validateIndex(target, count);
  const distance = new Float64Array(count).fill(Infinity);
  const next = new Int32Array(count).fill(-1);
  const settled = new Uint8Array(count);
  const adjacent = new Int32Array(4);
  const heap = new MinHeap();
  for (const target of targets) {
    if (grid.passable[target] === 0 || distance[target] === 0) continue;
    distance[target] = 0;
    next[target] = target;
    heap.push(target, 0, 0);
  }

  while (heap.size > 0) {
    const cell = heap.cell;
    const travelled = heap.distance;
    heap.pop();
    if (settled[cell] !== 0 || travelled !== distance[cell]) continue;
    settled[cell] = 1;
    // Reverse edge predecessor -> cell pays the cost of entering cell.
    const candidate = travelled + (grid.costs?.[cell] ?? 1);
    const length = neighbors(grid, cell, adjacent);
    for (let n = 0; n < length; n++) {
      const predecessor = adjacent[n];
      if (grid.passable[predecessor] === 0 || settled[predecessor] !== 0) continue;
      if (candidate < distance[predecessor]) {
        distance[predecessor] = candidate;
        next[predecessor] = cell;
        heap.push(predecessor, candidate, candidate);
      } else if (candidate === distance[predecessor] && cell < next[predecessor]) {
        next[predecessor] = cell;
      }
    }
  }
  return { distance, next };
}
