import { BlockType, NpcRole, NpcState, VehicleState } from "../../contracts/types";
import type { EntitySelection, InspectorData, NpcId, RenderSnapshot, Scenario, SimEvent, VehicleId } from "../../contracts/types";
import type { World } from "../world/grid";
import { buildFlowField, findPath, type NavGrid } from "../nav";
import { buildHazardGrid } from "../nav/hazards";
import { beginTrafficTick, congestionFactors, finishTrafficTick, markTrafficWaiting, tryEnterTraffic, type TrafficState } from "../traffic";
import type { PopulationState } from "./population";
import { assertMovementEntry } from "../invariants/movement";

export interface AgentRoute { cells: number[]; modes: number[]; cursor: number; progress: number; goal: number; version: number; guidanceVersion?: number; crowdReroutePending?: boolean }
interface Routing {
  foot: NavGrid; road: NavGrid;
  footFields: Map<number, ReturnType<typeof buildFlowField>>;
  carFields: Map<number, ReturnType<typeof buildFlowField>>;
  remainingCells: number; fields: number; plans: number;
}
class PlanningDeferred extends Error {}
export interface AgentSystem {
  population: PopulationState;
  routes: Map<number, AgentRoute>;
  shelters: Scenario["buildings"];
  shelterRemaining: Int32Array;
  shelterAssignment: Int32Array;
  hazardSince: number;
  intent: Uint8Array;
  rescueHandoff: Uint8Array;
  retry: Int32Array;
  decisions: Map<number, NonNullable<InspectorData["lastDecision"]>>;
  version: number;
  lastTick: number;
  planningQueued: Uint8Array;
  planningStats: { fields: number; plans: number; deferred: number; retainedBytes: number };
  routeCells: number;
  guidanceVersion: number;
  crowdGuidance: Uint8Array;
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
  const shelters = scenario.buildings.filter((building) => building.type === BlockType.Shelter).sort((a, b) => a.id - b.id);
  return { population, routes: new Map(), shelters, shelterRemaining: Int32Array.from(shelters.map((b) => b.capacity)), shelterAssignment: new Int32Array(population.npcs.id.length).fill(-1), hazardSince: -1,
    intent: new Uint8Array(population.npcs.id.length), rescueHandoff: new Uint8Array(population.npcs.id.length), retry: new Int32Array(population.npcs.id.length), decisions: new Map(), version: 0, lastTick: 0,
    planningQueued: new Uint8Array(population.npcs.id.length), planningStats: { fields: 0, plans: 0, deferred: 0, retainedBytes: 0 }, routeCells: 0,
    guidanceVersion: 0, crowdGuidance: new Uint8Array(world.width * world.height) };
}
function discardRoute(a: AgentSystem, i: number): void {
  const route = a.routes.get(i);
  if (route) a.routeCells -= route.cells.length + route.modes.length;
  a.routes.delete(i);
}

/** Atomically reserves shelter capacity before a rescue boat boards a civilian. */
export function reserveRescuedShelter(a: AgentSystem, npc: number, cell: number, world: World, scenario: Scenario, blocked: Uint8Array): boolean {
  if (!Number.isInteger(npc) || npc < 0 || npc >= a.population.civilianCount || !Number.isInteger(cell) || cell < 0 || cell >= world.width * world.height) {
    throw new RangeError("Rescued civilian or landing cell is outside the simulation");
  }
  const foot = buildHazardGrid(world, scenario, "foot", blocked);
  const existing = a.shelterAssignment[npc];
  if (existing >= 0) {
    const shelter = a.shelters[existing];
    if (shelter && shelter.capacity > 0 && !shelter.cells.some((candidate) => world.water[candidate] > shelter.floorHeight) && findPath(foot, cell, shelter.entrance)) return true;
    a.shelterAssignment[npc] = -1;
  }
  const reservations = new Int32Array(a.shelters.length);
  for (const assignment of a.shelterAssignment) if (assignment >= 0) reservations[assignment]++;
  let selected = -1;
  let bestLength = Infinity;
  for (let index = 0; index < a.shelters.length; index++) {
    const shelter = a.shelters[index];
    if (shelter.capacity <= reservations[index] || shelter.cells.some((candidate) => world.water[candidate] > shelter.floorHeight)) continue;
    const path = findPath(foot, cell, shelter.entrance);
    if (!path) continue;
    if (selected < 0 || path.length < bestLength || path.length === bestLength && shelter.id < a.shelters[selected].id) {
      selected = index;
      bestLength = path.length;
    }
  }
  if (selected < 0) return false;
  a.shelterAssignment[npc] = selected;
  return true;
}

export function releaseRescuedShelter(a: AgentSystem, npc: number): boolean {
  if (!Number.isInteger(npc) || npc < 0 || npc >= a.population.civilianCount) throw new RangeError("Rescued civilian is outside the shelter reservation table");
  if (a.shelterAssignment[npc] < 0) return false;
  a.shelterAssignment[npc] = -1;
  if (a.population.npcs.state[npc] === NpcState.Respond) {
    a.intent[npc] = 0;
    a.population.npcs.state[npc] = NpcState.Stranded;
  }
  return true;
}

/** Removes an aboard civilian from foot-route processing until shore handoff. */
export function markRescuedAboard(a: AgentSystem, npc: number): void {
  if (!Number.isInteger(npc) || npc < 0 || npc >= a.population.civilianCount) throw new RangeError("Rescued civilian is outside the agent table");
  discardRoute(a, npc);
  a.intent[npc] = 0;
  a.rescueHandoff[npc] = 0;
  a.planningQueued[npc] = 0;
  a.population.npcs.state[npc] = NpcState.Respond;
}

export function requeueFailedRescue(a: AgentSystem, npc: number): void {
  if (!Number.isInteger(npc) || npc < 0 || npc >= a.population.civilianCount) throw new RangeError("Rescued civilian is outside the agent table");
  discardRoute(a, npc);
  a.intent[npc] = 0;
  a.rescueHandoff[npc] = 0;
  a.planningQueued[npc] = 0;
  a.population.npcs.state[npc] = NpcState.Stranded;
}

/** Transfers a shore-landed civilian to a reachable home or one reserved shelter place. */
export function handoffRescuedCivilian(a: AgentSystem, npc: number, cell: number, world: World, scenario: Scenario, blocked: Uint8Array, shelterRequired: boolean): boolean {
  const n = a.population.npcs;
  if (!Number.isInteger(npc) || npc < 0 || npc >= a.population.civilianCount || !Number.isInteger(cell) || cell < 0 || cell >= world.width * world.height) {
    throw new RangeError("Rescued civilian or landing cell is outside the simulation");
  }
  const foot = buildHazardGrid(world, scenario, "foot", blocked);
  if (shelterRequired) {
    if (!reserveRescuedShelter(a, npc, cell, world, scenario, blocked)) return false;
    a.intent[npc] = 3;
    a.rescueHandoff[npc] = 0;
    n.state[npc] = NpcState.Evacuate;
  } else {
    const home = scenario.buildings.find((building) => building.id === n.homeBuilding[npc]);
    if (!home || home.cells.some((candidate) => world.water[candidate] > home.floorHeight) || !findPath(foot, cell, home.entrance)) return false;
    a.intent[npc] = 2;
    a.rescueHandoff[npc] = 1;
    n.state[npc] = NpcState.ReturnHome;
  }
  discardRoute(a, npc);
  a.planningQueued[npc] = 0;
  a.retry[npc] = 0;
  n.cell[npc] = cell;
  n.x[npc] = cell % world.width + 0.5;
  n.z[npc] = Math.floor(cell / world.width) + 0.5;
  return true;
}

const POLICE_ESCORT_SPEED_FACTOR = 1.1;

function walkingSpeed(a: AgentSystem, i: number, escorted = false): number {
  const n = a.population.npcs;
  return 0.35 * n.speed[i] * (n.mobility[i] === 2 ? 0.35 : n.mobility[i] === 1 ? 0.65 : 1) * (1 - 0.5 * n.fatigue[i]) * (escorted ? POLICE_ESCORT_SPEED_FACTOR : 1);
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
function plan(a: AgentSystem, i: number, goal: number, routing: Routing): AgentRoute | null {
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
export function stepAgents(a: AgentSystem, world: World, scenario: Scenario, tick: number, blocked: Uint8Array, traffic: TrafficState, policeControlled?: Uint8Array, escortGuidance?: ReadonlySet<number>, crowdGuidance?: Uint8Array): SimEvent[] {
  if (!Number.isSafeInteger(tick) || tick !== a.lastTick + 1) throw new RangeError("Agents require consecutive one-second ticks");
  for (const npc of escortGuidance ?? []) if (!Number.isInteger(npc) || npc < 0 || npc >= a.population.civilianCount) throw new RangeError("Police escort guidance contains an invalid civilian index");
  const count = world.width * world.height;
  if (crowdGuidance !== undefined && (!(crowdGuidance instanceof Uint8Array) || crowdGuidance.length !== count)) throw new RangeError("Police crowd guidance mask must be a grid-sized Uint8Array");
  const nextGuidance = crowdGuidance ?? new Uint8Array(count);
  const guidanceChangedCells = new Uint8Array(count);
  let guidanceChanged = false;
  for (let cell = 0; cell < count; cell++) {
    if (nextGuidance[cell] > 1) throw new RangeError("Police crowd guidance mask must contain only binary values");
    if (nextGuidance[cell] !== a.crowdGuidance[cell]) { guidanceChanged = true; guidanceChangedCells[cell] = 1; }
  }
  if (guidanceChanged) { a.guidanceVersion++; a.crowdGuidance = nextGuidance.slice(); }
  const baseFoot = buildHazardGrid(world, scenario, "foot", blocked);
  let foot = baseFoot;
  if (nextGuidance.some((value) => value !== 0)) {
    const costs = baseFoot.costs!.slice();
    for (let cell = 0; cell < count; cell++) if (nextGuidance[cell] && baseFoot.passable[cell]) costs[cell] = Math.min(65536, costs[cell] * 4);
    foot = { ...baseFoot, costs };
  }
  beginTrafficTick(traffic, world, policeControlled);
  const road = buildHazardGrid(world, scenario, "car", blocked, congestionFactors(traffic));
  const routing: Routing = { foot, road, footFields: new Map(), carFields: new Map(), remainingCells: 49152, fields: 0, plans: 0 };
  a.planningStats = { fields: 0, plans: 0, deferred: 0, retainedBytes: 0 };
  a.lastTick = tick;
  const { npcs: n, cars } = a.population; const events: SimEvent[] = [];
  const shelterDeficit = new Int32Array(a.shelters.length);
  const floodStarted = a.hazardSince >= 0 || world.water.some((depth) => depth > 0.05);
  if (a.hazardSince < 0 && floodStarted) a.hazardSince = tick;
  const officialWarning = a.hazardSince >= 0 && tick - a.hazardSince >= a.population.params.warningDelay;
  const hospitals = scenario.buildings.filter((b) => b.type === BlockType.Hospital).sort((x, y) => x.id - y.id);
  const operational = hospitals.filter((b) => b.capacity > 0 && world.powered[b.entrance] > 0 && !b.cells.some((cell) => world.water[cell] > b.floorHeight));
  const operationalCells = new Set(operational.map((b) => b.entrance));
  for (let shelter = 0; shelter < a.shelters.length; shelter++) {
    const building = a.shelters[shelter];
    if (building.capacity === 0 || building.cells.some((cell) => world.water[cell] > building.floorHeight)) shelterDeficit[shelter] = 1;
  }
  const reserved = new Int32Array(a.shelters.length);
  for (const shelter of a.shelterAssignment) if (shelter >= 0) reserved[shelter]++;
  for (let shelter = 0; shelter < a.shelters.length; shelter++) {
    a.shelterRemaining[shelter] = shelterDeficit[shelter] ? 0 : Math.max(0, a.shelters[shelter].capacity - reserved[shelter]);
  }
  const civilians = Math.max(1, a.population.civilianCount);
  let evacuees = 0;
  for (let i = 0; i < n.id.length; i++) if (n.state[i] === NpcState.Evacuate || n.state[i] === NpcState.ShelterInPlace) evacuees++;
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
    const isCivilian = n.baseRole[i] === NpcRole.Civilian;
    if (isCivilian && n.state[i] !== NpcState.ShelterInPlace && a.intent[i] !== 3) {
      let localDepth = world.water[n.cell[i]];
      const x = n.cell[i] % world.width; const z = Math.floor(n.cell[i] / world.width);
      if (z > 0) localDepth = Math.max(localDepth, world.water[n.cell[i] - world.width]);
      if (x + 1 < world.width) localDepth = Math.max(localDepth, world.water[n.cell[i] + 1]);
      if (z + 1 < world.height) localDepth = Math.max(localDepth, world.water[n.cell[i] + world.width]);
      if (x > 0) localDepth = Math.max(localDepth, world.water[n.cell[i] - 1]);
      const threat = Math.min(1, localDepth / 0.5);
      const official = officialWarning ? 1 : 0;
      const evacuationUtility = 0.4 * threat + 0.9 * official * n.compliance[i] +
        0.25 * (evacuees / civilians) + 0.2 * n.panic[i] -
        0.55 * threat * (1 - n.riskTolerance[i]) - 0.08;
      if ((officialWarning || localDepth >= 0.3) && evacuationUtility >= 0.35) {
        const origin = cachedField(foot, n.cell[i], routing.footFields, routing);
        let selected = -1; let bestCost = Infinity;
        for (let shelter = 0; shelter < a.shelters.length; shelter++) {
          if (a.shelterRemaining[shelter] <= 0 || shelterDeficit[shelter]) continue;
          const building = a.shelters[shelter];
          const cost = origin.distance[building.entrance] - (foot.costs?.[n.cell[i]] ?? 1) + (foot.costs?.[building.entrance] ?? 1);
          if (Number.isFinite(cost) && cost < bestCost) { selected = shelter; bestCost = cost; }
        }
        if (selected >= 0) {
          a.shelterRemaining[selected]--; a.shelterAssignment[i] = selected; a.intent[i] = 3;
          const shelter = a.shelters[selected];
          events.push({ tick, type: "NPC_STATE", actor: n.id[i] as NpcId, actorKind: "npc", cell: n.cell[i], data: { state: NpcState.Warned }, reason: officialWarning ? "Delayed synthetic flood alert reached this civilian" : "Nearby water triggered a local hazard warning" });
          events.push({ tick, type: "EVAC_ORDER", actor: n.id[i] as NpcId, actorKind: "npc", target: shelter.id, targetKind: "building", cell: n.cell[i], data: { official: Boolean(officialWarning), utility: evacuationUtility }, reason: "Civilian accepted a flood evacuation order and reserved one reachable shelter place" });
          n.state[i] = NpcState.Evacuate;
          if (!a.routes.has(i) || a.routes.get(i)!.progress === 0) discardRoute(a, i);
          a.planningQueued[i] = 0; evacuees++;
        } else if (officialWarning || localDepth >= 0.3) {
          if (n.state[i] !== NpcState.Stranded) events.push({ tick, type: "NPC_STRANDED", actor: n.id[i] as NpcId, actorKind: "npc", cell: n.cell[i], reason: "No reachable shelter place is currently available" });
          n.state[i] = NpcState.Stranded; a.intent[i] = 3;
        }
      }
    }
    if (a.shelterAssignment[i] >= 0) {
      const shelter = a.shelterAssignment[i];
      if (shelterDeficit[shelter]) {
        a.shelterRemaining[shelter] = 0;
        a.shelterAssignment[i] = -1;
        n.state[i] = NpcState.Stranded; a.intent[i] = 3; a.retry[i] = tick;
      }
    }
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
    const shelterTrip = a.intent[i] === 3;
    if (shelterTrip && a.shelterAssignment[i] < 0 && tick < a.retry[i]) continue;
    if (shelterTrip && a.shelterAssignment[i] < 0 && tick >= a.retry[i]) {
      const origin = cachedField(foot, n.cell[i], routing.footFields, routing);
      let selected = -1; let bestCost = Infinity;
      for (let shelter = 0; shelter < a.shelters.length; shelter++) {
        if (a.shelterRemaining[shelter] <= 0 || shelterDeficit[shelter]) continue;
        const building = a.shelters[shelter]; const cost = origin.distance[building.entrance] - (foot.costs?.[n.cell[i]] ?? 1) + (foot.costs?.[building.entrance] ?? 1);
        if (Number.isFinite(cost) && cost < bestCost) { selected = shelter; bestCost = cost; }
      }
      if (selected < 0) { a.retry[i] = tick + 8; continue; }
      a.shelterRemaining[selected]--; a.shelterAssignment[i] = selected; n.state[i] = NpcState.Evacuate;
      events.push({ tick, type: "EVAC_ORDER", actor: n.id[i] as NpcId, actorKind: "npc", target: a.shelters[selected].id, targetKind: "building", cell: n.cell[i], reason: "Reserved the first reachable shelter place that became available" });
    }
    const goal = shelterTrip ? a.shelters[a.shelterAssignment[i]].entrance : a.intent[i] === 1 ? n.work[i] : n.home[i];
    if (goal < 0) { n.state[i] = NpcState.SeekHelp; continue; }
    let route = a.routes.get(i);
    let pendingCrowdReroute = false;
    if (route) {
      const guidanceStale = (route.guidanceVersion ?? 0) !== a.guidanceVersion;
      const guidedRouteChanged = guidanceStale && (route.cursor > 0 && route.modes[route.cursor - 1] === 0 && guidanceChangedCells[route.cells[route.cursor - 1]] !== 0 ||
        route.cells.slice(route.cursor).some((cell, offset) => route!.modes[route!.cursor + offset] === 0 && guidanceChangedCells[cell] !== 0));
      pendingCrowdReroute = route.crowdReroutePending === true || guidedRouteChanged && route.progress > 0;
      route.crowdReroutePending = pendingCrowdReroute;
      if (guidanceStale && !guidedRouteChanged && !pendingCrowdReroute) route.guidanceVersion = a.guidanceVersion;
      const carFailed = n.car[i] >= 0 && cars.state[n.car[i]] === VehicleState.Failed;
      if (carFailed) n.role[i] = n.baseRole[i];
      if (carFailed && route.progress > 0 && route.modes[route.cursor] === 1) {
        route.modes[route.cursor] = 0;
        a.routeCells -= route.cells.length + route.modes.length - 2 * (route.cursor + 1);
        route.cells.length = route.cursor + 1; route.modes.length = route.cursor + 1;
        route.goal = -1; // Finish this edge walking, then replan before any next edge.
      }
      const invalid = route.goal !== goal || route.cells.slice(route.cursor).some((cell, j) => !(route!.modes[route!.cursor + j] ? road : foot).passable[cell]);
      const crowdReroute = route.progress === 0 && (guidedRouteChanged || pendingCrowdReroute);
      if (route.progress === 0 && (invalid || carFailed && route.modes.includes(1) || crowdReroute)) {
        if (crowdReroute) { route.guidanceVersion = a.guidanceVersion; route.crowdReroutePending = false; }
        discardRoute(a, i); route = undefined; a.retry[i] = tick;
        const car = n.car[i]; if (car >= 0 && cars.state[car] !== VehicleState.Failed) cars.state[car] = VehicleState.Idle;
        n.role[i] = n.baseRole[i];
        event(i, "REROUTE", crowdReroute ? "Police crowd guidance changed the foot-route cost; recomputing at a safe node" : "Remaining route or vehicle is unavailable; recomputing without teleporting");
      }
    }
    if (!route && tick >= a.retry[i] && goal >= 0) {
        route = plan(a, i, goal, routing) ?? undefined;
      a.planningQueued[i] = 0;
      if (route) {
        route.version = ++a.version; route.guidanceVersion = a.guidanceVersion; a.routeCells += route.cells.length + route.modes.length;
        a.routes.set(i, route); n.state[i] = shelterTrip ? NpcState.Evacuate : a.intent[i] === 1 ? NpcState.Commute : NpcState.ReturnHome;
        event(i, "ROUTE_PLANNED", "Selected the fastest currently reachable walking or walk-drive-walk route");
      } else {
        if (shelterTrip) {
          const shelter = a.shelterAssignment[i]; a.shelterRemaining[shelter]++; a.shelterAssignment[i] = -1;
          n.state[i] = NpcState.Stranded; a.retry[i] = tick + 8;
          events.push({ tick, type: "NPC_STRANDED", actor: n.id[i] as NpcId, actorKind: "npc", cell: n.cell[i], reason: "Reserved shelter became unreachable; releasing capacity and retrying" });
        } else {
          if (n.state[i] !== NpcState.SeekHelp) event(i, "NPC_STATE", "Destination is unreachable; waiting safely and retrying in eight seconds");
          n.state[i] = NpcState.SeekHelp; a.retry[i] = tick + 8;
        }
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
      const speed = (driving ? 2 : walkingSpeed(a, i, escortGuidance?.has(i) === true)) / (grid.costs?.[target] ?? 1);
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
        if (route.goal !== goal || pendingCrowdReroute) break; // Replan at this node next tick, never reset a partial edge.
      }
    }
    if (route.cursor === route.cells.length && route.goal === goal) {
      if (shelterTrip) { n.state[i] = NpcState.ShelterInPlace; a.intent[i] = 0; }
      else if (a.intent[i] === 1) { n.state[i] = NpcState.Work; n.workUntil[i] = tick + n.workDuration[i]; }
      else { n.state[i] = NpcState.AtHome; a.rescueHandoff[i] = 0; while (n.departTick[i] <= tick) n.departTick[i] += 86400; }
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
