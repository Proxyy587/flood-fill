import { BlockType, NpcRole, NpcState, VehicleState } from "../../contracts/types";
import type { EntitySelection, InspectorData, NpcId, RenderSnapshot, Scenario, SimEvent, VehicleId } from "../../contracts/types";
import type { World } from "../world/grid";
import { buildFlowField, type NavGrid } from "../nav";
import { buildHazardGrid } from "../nav/hazards";
import { beginTrafficTick, congestionFactors, finishTrafficTick, markTrafficWaiting, tryEnterTraffic, type TrafficState } from "../traffic";
import type { PopulationState } from "./population";
import { assertMovementEntry } from "../invariants/movement";

interface Route { cells: number[]; modes: number[]; cursor: number; progress: number; goal: number; version: number }
interface Routing {
  foot: NavGrid; road: NavGrid;
  footFields: Map<number, ReturnType<typeof buildFlowField>>;
  carFields: Map<number, ReturnType<typeof buildFlowField>>;
  remainingCells: number; fields: number; plans: number;
}
class PlanningDeferred extends Error {}
export interface AgentSystem {
  population: PopulationState;
  routes: Map<number, Route>;
  intent: Uint8Array;
  retry: Int32Array;
  decisions: Map<number, NonNullable<InspectorData["lastDecision"]>>;
  version: number;
  lastTick: number;
  planningQueued: Uint8Array;
  planningStats: { fields: number; plans: number; deferred: number; retainedBytes: number };
  routeCells: number;
}

function pathToField(grid: NavGrid, start: number, field: ReturnType<typeof buildFlowField>): number[] | null {
  if (!Number.isFinite(field.distance[start])) return null;
  const cells = [start]; let cell = start;
  for (let count = 0; count < grid.passable.length; count++) {
    const next = field.next[cell];
    if (next === cell) return cells;
    if (next < 0) return null;
    cells.push(next); cell = next;
  }
  throw new Error("Flow field contains a cycle");
}

/** Parking is initialization, not a simulated movement or a housing allocation. */
export function createAgentSystem(population: PopulationState, world: World, scenario: Scenario): AgentSystem {
  const foot = buildHazardGrid(world, scenario, "foot");
  const road = buildHazardGrid(world, scenario, "car");
  const targets: number[] = [];
  for (let cell = 0; cell < road.passable.length; cell++) if (road.passable[cell]) targets.push(cell);
  const field = buildFlowField(foot, targets);
  const cars = population.cars;
  for (let i = 0; i < cars.id.length; i++) {
    const path = pathToField(foot, cars.cell[i], field);
    if (path) cars.cell[i] = path[path.length - 1];
    cars.x[i] = cars.cell[i] % world.width + 0.5; cars.z[i] = Math.floor(cars.cell[i] / world.width) + 0.5;
  }
  return { population, routes: new Map(), intent: new Uint8Array(population.npcs.id.length), retry: new Int32Array(population.npcs.id.length), decisions: new Map(), version: 0, lastTick: 0,
    planningQueued: new Uint8Array(population.npcs.id.length), planningStats: { fields: 0, plans: 0, deferred: 0, retainedBytes: 0 }, routeCells: 0 };
}
function discardRoute(a: AgentSystem, i: number): void {
  const route = a.routes.get(i);
  if (route) a.routeCells -= route.cells.length + route.modes.length;
  a.routes.delete(i);
}

function walkingSpeed(a: AgentSystem, i: number): number {
  const n = a.population.npcs;
  return 0.35 * n.speed[i] * (n.mobility[i] === 2 ? 0.35 : n.mobility[i] === 1 ? 0.65 : 1) * (1 - 0.5 * n.fatigue[i]);
}
function cachedField(grid: NavGrid, goal: number, cache: Routing["footFields"], routing: Routing) {
  let field = cache.get(goal);
  if (!field) {
    if (routing.remainingCells < grid.passable.length) throw new PlanningDeferred();
    routing.remainingCells -= grid.passable.length; routing.fields++;
    field = buildFlowField(grid, [goal]);
    // FIFO eviction is deterministic. At 128x128 this retains <=3MiB per cache.
    if (cache.size >= 16) cache.delete(cache.keys().next().value!);
    cache.set(goal, field);
  }
  return field;
}
function plan(a: AgentSystem, i: number, goal: number, routing: Routing): Route | null {
  if (routing.plans >= 256) throw new PlanningDeferred();
  routing.plans++;
  const { foot, road, footFields, carFields } = routing;
  const { npcs: n, cars } = a.population;
  const destination = cachedField(foot, goal, footFields, routing);
  const direct = pathToField(foot, n.cell[i], destination);
  let cells = direct; let modes = direct?.map(() => 0) ?? [];
  let best = destination.distance[n.cell[i]] / walkingSpeed(a, i);
  const car = n.car[i];
  if (car >= 0 && cars.state[car] !== VehicleState.Failed && road.passable[cars.cell[car]]) {
    const access = cachedField(foot, cars.cell[car], footFields, routing);
    const toCar = pathToField(foot, n.cell[i], access);
    if (toCar) {
      const driving = cachedField(road, cars.cell[car], carFields, routing);
      let bestAccess = -1;
      // Select a reachable road access, including its final walking leg.
      for (let cell = 0; cell < road.passable.length; cell++) {
        if (cell === cars.cell[car] || !road.passable[cell]) continue;
        // Reversing an entering-cost path changes only the endpoint costs.
        const driveCost = driving.distance[cell] - (road.costs?.[cars.cell[car]] ?? 1) + (road.costs?.[cell] ?? 1);
        const time = access.distance[n.cell[i]] / walkingSpeed(a, i) + driveCost / 2 + destination.distance[cell] / walkingSpeed(a, i);
        if (time < best) { best = time; bestAccess = cell; }
      }
      if (bestAccess >= 0) {
        const drive = pathToField(road, bestAccess, driving)!.reverse();
        const after = pathToField(foot, bestAccess, destination)!;
        cells = [...toCar, ...drive.slice(1), ...after.slice(1)];
        modes = [...toCar.map(() => 0), ...drive.slice(1).map(() => 1), ...after.slice(1).map(() => 0)];
      }
    }
  }
  if (cells && a.routeCells + cells.length + modes.length > 262144) throw new PlanningDeferred();
  return cells ? { cells, modes, cursor: 1, progress: 0, goal, version: 0 } : null;
}

/** One deterministic second. All entry checks use the current hazard graph. */
export function stepAgents(a: AgentSystem, world: World, scenario: Scenario, tick: number, blocked: Uint8Array, traffic: TrafficState): SimEvent[] {
  if (!Number.isSafeInteger(tick) || tick !== a.lastTick + 1) throw new RangeError("Agents require consecutive one-second ticks");
  const foot = buildHazardGrid(world, scenario, "foot", blocked);
  beginTrafficTick(traffic, world);
  const road = buildHazardGrid(world, scenario, "car", blocked, congestionFactors(traffic));
  const routing: Routing = { foot, road, footFields: new Map(), carFields: new Map(), remainingCells: 49152, fields: 0, plans: 0 };
  a.planningStats = { fields: 0, plans: 0, deferred: 0, retainedBytes: 0 };
  a.lastTick = tick;
  const { npcs: n, cars } = a.population; const events: SimEvent[] = [];
  const hospitals = scenario.buildings.filter((b) => b.type === BlockType.Hospital).sort((x, y) => x.id - y.id);
  const operational = hospitals.filter((b) => b.capacity > 0 && world.powered[b.entrance] > 0 && !b.cells.some((cell) => world.water[cell] > b.floorHeight));
  const operationalCells = new Set(operational.map((b) => b.entrance));
  function event(i: number, type: SimEvent["type"], reason: string) {
    events.push({ tick, type, actor: n.id[i] as NpcId, actorKind: "npc", cell: n.cell[i], reason });
    a.decisions.set(i, { tick, chosen: type, alternatives: [], reason });
  }
  for (let car = 0; car < cars.id.length; car++) {
    const cell = cars.cell[car];
    const onRoad = world.block[cell] === BlockType.Road || world.block[cell] === BlockType.Bridge;
    if (cars.state[car] !== VehicleState.Failed && onRoad && !road.passable[cell]) {
      cars.state[car] = VehicleState.Failed;
      events.push({ tick, type: "VEHICLE_STALLED", actor: cars.id[car] as VehicleId, actorKind: "vehicle", cell, reason: "Current road is no longer safe for this civilian car" });
    }
  }
  // Failed cars obstruct driving, not foot traffic. Other parked cars do not.
  for (let car = 0; car < cars.id.length; car++) if (cars.state[car] === VehicleState.Failed) road.passable[cars.cell[car]] = 0;
  for (let offset = 0; offset < n.id.length; offset++) {
    const i = (offset + tick % n.id.length) % n.id.length;
    try {
    const medical = n.baseRole[i] === NpcRole.Doctor || n.baseRole[i] === NpcRole.Nurse;
    const needsMedicalRoute = a.intent[i] === 1 || n.state[i] === NpcState.SeekHelp || n.state[i] === NpcState.AtHome && tick >= n.departTick[i];
    if (medical && (n.work[i] < 0 || !operationalCells.has(n.work[i]) || needsMedicalRoute && !Number.isFinite(cachedField(foot, n.cell[i], routing.footFields, routing).distance[n.work[i]]))) {
      let chosen = -1; let distance = Infinity;
      const origin = cachedField(foot, n.cell[i], routing.footFields, routing);
      for (const b of operational) {
        const cost = origin.distance[b.entrance] - (foot.costs?.[n.cell[i]] ?? 1) + (foot.costs?.[b.entrance] ?? 1);
        if (cost < distance) { chosen = b.entrance; distance = cost; }
      }
      if (chosen < 0) n.workBuilding[i] = 0;
      if (chosen !== n.work[i]) {
        n.workBuilding[i] = operational.find((b) => b.entrance === chosen)?.id ?? 0;
        n.work[i] = chosen;
        if (a.intent[i] === 1 || n.state[i] === NpcState.Work) { a.intent[i] = 1; n.state[i] = NpcState.Commute; }
        event(i, "NPC_STATE", chosen < 0 ? "No reachable powered hospital available" : "Medical workplace reassigned to a reachable powered hospital");
      }
    }
    if (n.state[i] === NpcState.Work) {
      if (medical) n.fatigue[i] = Math.min(1, n.fatigue[i] + a.population.params.staffFatigueRate);
      if (tick >= n.workUntil[i]) { a.intent[i] = 2; n.state[i] = NpcState.ReturnHome; }
    }
    if (n.state[i] === NpcState.AtHome && tick >= n.departTick[i] && n.work[i] >= 0) { a.intent[i] = 1; n.state[i] = NpcState.Commute; }
    if (a.intent[i] === 0) continue;
    const goal = a.intent[i] === 1 ? n.work[i] : n.home[i];
    if (goal < 0) { n.state[i] = NpcState.SeekHelp; continue; }
    let route = a.routes.get(i);
    if (route) {
      const carFailed = n.car[i] >= 0 && cars.state[n.car[i]] === VehicleState.Failed;
      if (carFailed) n.role[i] = n.baseRole[i];
      if (carFailed && route.progress > 0 && route.modes[route.cursor] === 1) {
        route.modes[route.cursor] = 0;
        a.routeCells -= route.cells.length + route.modes.length - 2 * (route.cursor + 1);
        route.cells.length = route.cursor + 1; route.modes.length = route.cursor + 1;
        route.goal = -1; // Finish this edge walking, then replan before any next edge.
      }
      const invalid = route.goal !== goal || route.cells.slice(route.cursor).some((cell, j) => !(route!.modes[route!.cursor + j] ? road : foot).passable[cell]);
      if (route.progress === 0 && (invalid || carFailed && route.modes.includes(1))) {
        discardRoute(a, i); route = undefined; a.retry[i] = tick;
        const car = n.car[i]; if (car >= 0 && cars.state[car] !== VehicleState.Failed) cars.state[car] = VehicleState.Idle;
        n.role[i] = n.baseRole[i];
        event(i, "REROUTE", "Remaining route or vehicle is unavailable; recomputing without teleporting");
      }
    }
    if (!route && tick >= a.retry[i] && goal >= 0) {
      route = plan(a, i, goal, routing) ?? undefined;
      a.planningQueued[i] = 0;
      if (route) {
        route.version = ++a.version; a.routeCells += route.cells.length + route.modes.length;
        a.routes.set(i, route); n.state[i] = a.intent[i] === 1 ? NpcState.Commute : NpcState.ReturnHome;
        event(i, "ROUTE_PLANNED", "Selected the fastest currently reachable walking or walk-drive-walk route");
      } else {
        if (n.state[i] !== NpcState.SeekHelp) event(i, "NPC_STATE", "Destination is unreachable; waiting safely and retrying in eight seconds");
        n.state[i] = NpcState.SeekHelp; a.retry[i] = tick + 8;
      }
    }
    if (!route) continue;
    let remaining = 1;
    while (remaining > 1e-9 && route.cursor < route.cells.length) {
      const target = route.cells[route.cursor]; const driving = route.modes[route.cursor] === 1;
      const grid = driving ? road : foot;
      if (!grid.passable[target]) {
        if (n.state[i] !== NpcState.Stranded) event(i, "NPC_STATE", "Current edge is unsafe; holding position until it reopens");
        n.state[i] = NpcState.Stranded; break;
      }
      if (n.state[i] === NpcState.Stranded) n.state[i] = a.intent[i] === 1 ? NpcState.Commute : NpcState.ReturnHome;
      assertMovementEntry(world, route.cells[route.cursor - 1], target, driving ? "car" : "foot", blocked);
      if (driving && route.progress === 0 && !tryEnterTraffic(traffic, target)) { markTrafficWaiting(traffic, target); break; }
      const speed = (driving ? 2 : walkingSpeed(a, i)) / (grid.costs?.[target] ?? 1);
      const used = Math.min(remaining, (1 - route.progress) / speed);
      route.progress = Math.min(1, route.progress + used * speed); remaining -= used;
      const source = route.cells[route.cursor - 1];
      const dx = target % world.width - source % world.width;
      const dz = Math.floor(target / world.width) - Math.floor(source / world.width);
      n.x[i] = source % world.width + 0.5 + dx * route.progress;
      n.z[i] = Math.floor(source / world.width) + 0.5 + dz * route.progress; n.heading[i] = Math.atan2(dx, dz);
      n.role[i] = driving ? NpcRole.Driver : n.baseRole[i];
      const car = n.car[i];
      if (car >= 0 && cars.state[car] !== VehicleState.Failed) {
        cars.state[car] = driving ? VehicleState.Moving : VehicleState.Idle;
        if (driving) { cars.cell[car] = target; cars.x[car] = n.x[i]; cars.z[car] = n.z[i]; cars.heading[car] = n.heading[i]; }
      }
      if (route.progress >= 1) {
        n.cell[i] = target; route.cursor++; route.progress = 0;
        if (route.goal !== goal) break; // Replan at this node next tick, never reset a partial edge.
      }
    }
    if (route.cursor === route.cells.length && route.goal === goal) {
      if (a.intent[i] === 1) { n.state[i] = NpcState.Work; n.workUntil[i] = tick + n.workDuration[i]; }
      else { n.state[i] = NpcState.AtHome; while (n.departTick[i] <= tick) n.departTick[i] += 86400; }
      a.intent[i] = 0; discardRoute(a, i); n.role[i] = n.baseRole[i];
      const car = n.car[i]; if (car >= 0 && cars.state[car] !== VehicleState.Failed) cars.state[car] = VehicleState.Idle;
      event(i, "ARRIVED", "Completed the planned journey through safe adjacent cells");
    }
    } catch (error) {
      if (!(error instanceof PlanningDeferred)) throw error;
      a.planningStats.deferred++;
      if (!a.planningQueued[i]) event(i, "NPC_STATE", "Route planning queued for a later tick within the deterministic work budget");
      a.planningQueued[i] = 1;
    }
  }
  a.planningStats.fields = routing.fields; a.planningStats.plans = routing.plans;
  for (const cache of [routing.footFields, routing.carFields]) for (const field of cache.values()) a.planningStats.retainedBytes += field.distance.byteLength + field.next.byteLength;
  events.push(...finishTrafficTick(traffic, world, tick));
  return events;
}

export function agentSnapshot(a: AgentSystem): Pick<RenderSnapshot, "npcs" | "vehicles"> {
  const { npcs: n, cars: c } = a.population;
  return { npcs: { id: n.id.slice(), x: n.x.slice(), z: n.z.slice(), heading: n.heading.slice(), role: n.role.slice(), state: n.state.slice() },
    vehicles: { id: c.id.slice(), x: c.x.slice(), z: c.z.slice(), heading: c.heading.slice(), kind: c.kind.slice(), state: c.state.slice() } };
}
export function inspectAgent(a: AgentSystem, selection: EntitySelection): InspectorData | null {
  const { npcs: n, cars: c } = a.population;
  if (selection.kind === "npc") {
    const i = n.id.indexOf(selection.id); if (i < 0) return null;
    const route = a.routes.get(i);
    return structuredClone({ ...selection, title: `NPC ${selection.id}`, attributes: { role: NpcRole[n.role[i]], state: NpcState[n.state[i]], health: n.health[i], fatigue: n.fatigue[i], unhoused: n.unhoused[i], planningQueued: a.planningQueued[i], speed: n.speed[i], panic: n.panic[i], compliance: n.compliance[i], awareness: n.awareness[i] },
      ...(route ? { route: { cells: route.cells.slice(route.cursor - 1), version: route.version } } : {}), lastDecision: a.decisions.get(i) });
  }
  if (selection.kind === "vehicle") {
    const i = c.id.indexOf(selection.id); if (i < 0) return null;
    return { ...selection, title: `Civilian car ${selection.id}`, attributes: { state: VehicleState[c.state[i]], cell: c.cell[i] } };
  }
  return null;
}
