import { BlockType, NpcState } from "../../contracts/types";
import type { Scenario } from "../../contracts/types";
import type { AgentSystem, AgentRoute } from "../agents/system";
import { buildHazardGrid } from "../nav/hazards";
import { neighbours, type World } from "../world/grid";
import { PoliceTaskKind, type CrowdTaskCandidate } from "./police";

/** One cell is 16 m²: four people are 0.25 people/m², eight are 0.5. */
export const CROWD_HOTSPOT_THRESHOLD = 4;
export const CROWD_CLEAR_THRESHOLD = 2;
export const CROWD_CRITICAL_THRESHOLD = 8;
export const CROWD_HIGH_TICKS = 2;
export const CROWD_CLEAR_TICKS = 5;

/** Static, bounded set of safe shelter approaches and constricted foot cells. */
export interface CrowdControlSystem {
  targets: Int32Array;
  targetMask: Uint8Array;
  width: number;
  height: number;
  aboveTicks: Uint8Array;
  belowTicks: Uint8Array;
  active: Uint8Array;
  lastTick: number;
  navVersion: number;
}

/** Shared dispatcher candidate; crowd analysis retains no police ownership. */
export type CrowdControlCandidate = CrowdTaskCandidate;

export interface CrowdPressure {
  /** Number of eligible civilians occupying or approaching each grid cell. */
  peopleAtOrApproaching: Uint32Array;
  /** Number of civilian rows examined; exactly one bounded civilian pass. */
  npcScans: number;
}

function validateTopology(system: CrowdControlSystem, world: World): void {
  const length = world.width * world.height;
  if (system.width !== world.width || system.height !== world.height ||
      system.targetMask.length !== length || system.targets.length > length) {
    throw new RangeError("Crowd target topology must match the world grid");
  }
}

/**
 * Builds deterministic targets from passable foot topology. Grid cells are
 * 4 m by 4 m (16 m²), so the exported pressure thresholds map directly to
 * the documented density values.
 */
export function createCrowdControl(world: World, scenario: Scenario, blocked?: Uint8Array): CrowdControlSystem {
  const foot = buildHazardGrid(world, scenario, "foot", blocked);
  const length = world.width * world.height;
  const targetMask = new Uint8Array(length);
  const shelterApproaches = new Uint8Array(length);

  for (const building of scenario.buildings) {
    if (building.type !== BlockType.Shelter) continue;
    const entrance = building.entrance;
    if (entrance >= 0 && entrance < length) {
      if (foot.passable[entrance] === 1) shelterApproaches[entrance] = 1;
      for (const cell of neighbours(entrance, world.width, world.height)) {
        if (foot.passable[cell] === 1) shelterApproaches[cell] = 1;
      }
    }
  }

  const candidates: number[] = [];
  for (let cell = 0; cell < length; cell++) {
    if (foot.passable[cell] !== 1) continue;
    const degree = neighbours(cell, world.width, world.height)
      .reduce((count, adjacent) => count + Number(foot.passable[adjacent] === 1), 0);
    if (shelterApproaches[cell] === 1 || degree > 0 && degree <= 2) {
      targetMask[cell] = 1;
      candidates.push(cell);
    }
  }

  return { targets: Int32Array.from(candidates), targetMask, width: world.width, height: world.height,
    aboveTicks: new Uint8Array(length), belowTicks: new Uint8Array(length), active: new Uint8Array(length), lastTick: -1, navVersion: -1 };
}

function carDistances(origin: number, grid: ReturnType<typeof buildHazardGrid>, world: World): Int32Array {
  const length = world.width * world.height;
  const distances = new Int32Array(length).fill(-1);
  if (origin < 0 || origin >= length || grid.passable[origin] !== 1) return distances;
  const queue = new Int32Array(length);
  let head = 0; let tail = 0;
  queue[tail++] = origin;
  distances[origin] = 0;
  while (head < tail) {
    const cell = queue[head++];
    for (const next of neighbours(cell, world.width, world.height)) {
      if (grid.passable[next] !== 1 || distances[next] >= 0) continue;
      distances[next] = distances[cell] + 1;
      queue[tail++] = next;
    }
  }
  return distances;
}

function rendezvous(target: number, world: World, policeDistances: readonly Int32Array[],
  carGrid: ReturnType<typeof buildHazardGrid>): number {
  const roads = neighbours(target, world.width, world.height)
    .filter((cell) => (world.block[cell] === BlockType.Road || world.block[cell] === BlockType.Bridge) && carGrid.passable[cell] === 1)
    .sort((a, b) => a - b);
  let bestCell = -1;
  let bestDistance = Infinity;
  for (const road of roads) for (const distances of policeDistances) {
    const distance = distances[road];
    if (distance < 0) continue;
    if (distance < bestDistance || distance === bestDistance && road < bestCell) {
      bestCell = road;
      bestDistance = distance;
    }
  }
  return bestCell;
}

/** Applies two-tick activation and five-tick clear hysteresis, then returns ranked local candidates. */
export function stepCrowdControl(
  system: CrowdControlSystem,
  agents: AgentSystem,
  world: World,
  scenario: Scenario,
  blocked: Uint8Array | undefined,
  navVersion: number,
  tick: number,
  policeCells: Int32Array = new Int32Array(),
): { candidates: CrowdControlCandidate[]; pressure: CrowdPressure } {
  validateTopology(system, world);
  if (!Number.isSafeInteger(tick) || tick < 0 || tick <= system.lastTick) throw new RangeError("Crowd-control ticks must increase monotonically");
  if (!(policeCells instanceof Int32Array)) throw new RangeError("Police cells must be an Int32Array");
  if (system.navVersion !== navVersion) {
    const previous = system;
    const rebuilt = createCrowdControl(world, scenario, blocked);
    for (const cell of rebuilt.targets) {
      if (previous.targetMask[cell] !== 1) continue;
      rebuilt.aboveTicks[cell] = previous.aboveTicks[cell];
      rebuilt.belowTicks[cell] = previous.belowTicks[cell];
      rebuilt.active[cell] = previous.active[cell];
    }
    system.targets = rebuilt.targets;
    system.targetMask = rebuilt.targetMask;
    system.aboveTicks = rebuilt.aboveTicks;
    system.belowTicks = rebuilt.belowTicks;
    system.active = rebuilt.active;
    system.navVersion = navVersion;
  }
  const pressure = measureCrowdPressure(agents, world, scenario, system, blocked);
  const carGrid = buildHazardGrid(world, scenario, "car", blocked);
  const policeDistances = Array.from(policeCells, (cell) => carDistances(cell, carGrid, world));
  const candidates: CrowdControlCandidate[] = [];
  for (const cell of system.targets) {
    const count = pressure.peopleAtOrApproaching[cell];
    if (count >= CROWD_HOTSPOT_THRESHOLD) {
      system.aboveTicks[cell] = Math.min(CROWD_HIGH_TICKS, system.aboveTicks[cell] + 1);
      system.belowTicks[cell] = 0;
      if (system.aboveTicks[cell] >= CROWD_HIGH_TICKS) system.active[cell] = 1;
    } else {
      system.aboveTicks[cell] = 0;
      if (system.active[cell] === 1) {
        if (count < CROWD_CLEAR_THRESHOLD) {
          system.belowTicks[cell] = Math.min(CROWD_CLEAR_TICKS, system.belowTicks[cell] + 1);
          if (system.belowTicks[cell] >= CROWD_CLEAR_TICKS) system.active[cell] = 0;
        } else system.belowTicks[cell] = 0;
      }
    }
    if (system.active[cell] !== 1) continue;
    const exposure = world.water[cell];
    const targetCell = rendezvous(cell, world, policeDistances, carGrid);
    if (targetCell < 0) continue;
    candidates.push({ kind: PoliceTaskKind.CrowdControl, subject: -1, assignmentCell: cell, targetCell,
      urgency: count * 100_000 + Math.round(exposure * 1_000),
      critical: count >= CROWD_CRITICAL_THRESHOLD && exposure >= 0.3 });
  }
  candidates.sort((a, b) => b.urgency - a.urgency || a.assignmentCell - b.assignmentCell || a.targetCell - b.targetCell);
  system.lastTick = tick;
  return { candidates, pressure };
}

function eligibleRoute(agents: AgentSystem, npc: number): AgentRoute | undefined {
  const state = agents.population.npcs.state[npc];
  const evacuating = agents.intent[npc] === 3 && state === NpcState.Evacuate;
  const returning = agents.rescueHandoff[npc] === 1 && agents.intent[npc] === 2 && state === NpcState.ReturnHome;
  if (!evacuating && !returning) return undefined;
  const route = agents.routes.get(npc);
  if (!route || route.cursor < 0 || route.cursor >= route.cells.length || route.goal < 0) return undefined;
  return route;
}

/** Counts each eligible civilian at most once using one scan and candidate-mask lookups. */
export function measureCrowdPressure(
  agents: AgentSystem,
  world: World,
  scenario: Scenario,
  topology: CrowdControlSystem = createCrowdControl(world, scenario),
  blocked?: Uint8Array,
): CrowdPressure {
  validateTopology(topology, world);
  const foot = buildHazardGrid(world, scenario, "foot", blocked);
  const pressure = new Uint32Array(world.width * world.height);
  const npcs = agents.population.npcs;

  for (let npc = 0; npc < agents.population.civilianCount; npc++) {
    const route = eligibleRoute(agents, npc);
    if (!route || route.modes[route.cursor] !== 0) continue;
    const current = npcs.cell[npc];
    const next = route.cells[route.cursor];
    if (current < 0 || current >= topology.targetMask.length || foot.passable[current] !== 1 ||
        next < 0 || next >= topology.targetMask.length || foot.passable[next] !== 1) continue;
    let target = -1;
    if (topology.targetMask[current] === 1) {
      target = current;
    } else {
      if (topology.targetMask[next] === 1) target = next;
    }
    if (target >= 0) pressure[target]++;
  }

  return { peopleAtOrApproaching: pressure, npcScans: agents.population.civilianCount };
}
