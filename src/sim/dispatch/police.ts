import { BlockType, VehicleKind, VehicleState } from "../../contracts/types";
import type { Scenario, SimEvent, VehicleId } from "../../contracts/types";
import { assertMovementEntry } from "../invariants/movement";
import { buildHazardGrid, canEnter } from "../nav/hazards";
import { findPath } from "../nav";
import type { TrafficState } from "../traffic";
import { neighbours, type World } from "../world/grid";

export interface PoliceRoute {
  cells: Int32Array;
  cursor: number;
  target: number;
  navVersion: number;
}

export enum PoliceTaskKind { None, TrafficControl, Escort, CrowdControl }
export interface PoliceTaskCandidate { kind: PoliceTaskKind.Escort; subject: number; civilianId: number; members: readonly number[]; assignmentCell: number; targetCell: number; urgency: number; critical: false; eligibleSince: number }
export interface CrowdTaskCandidate { kind: PoliceTaskKind.CrowdControl; subject: -1; assignmentCell: number; targetCell: number; urgency: number; critical: boolean }
export type PoliceDispatchCandidate = PoliceTaskCandidate | CrowdTaskCandidate;

export interface PoliceSystem {
  count: number;
  id: Int32Array;
  available: Uint8Array;
  state: Uint8Array;
  cell: Int32Array;
  x: Float32Array;
  z: Float32Array;
  heading: Float32Array;
  assignment: Int32Array;
  taskKind: Uint8Array;
  taskSubject: Int32Array;
  escortArrived: Uint8Array;
  criticalCrowdActive: Uint8Array;
  target: Int32Array;
  routes: (PoliceRoute | null)[];
}

function safeStationRoads(world: World, scenario: Scenario, blocked: Uint8Array): number[] {
  const roads = new Set<number>();
  for (const station of scenario.buildings
    .filter((building) => building.type === BlockType.PoliceStation)
    .sort((a, b) => a.id - b.id)) {
    for (const stationCell of [...station.cells].sort((a, b) => a - b)) {
      for (const cell of neighbours(stationCell, world.width, world.height)) {
        if ((world.block[cell] === BlockType.Road || world.block[cell] === BlockType.Bridge) &&
            canEnter(world, scenario, "car", cell, blocked)) roads.add(cell);
      }
    }
  }
  return [...roads].sort((a, b) => a - b);
}

export function createPolice(scenario: Scenario, world: World, blocked: Uint8Array): PoliceSystem {
  const length = world.width * world.height;
  if (blocked.length !== length) throw new RangeError("Blocked mask must match the police map");
  const count = Math.min(scenario.fleet.policeCars, scenario.fleet.policeOfficers);
  const roads = safeStationRoads(world, scenario, blocked);
  const id = Int32Array.from({ length: count }, (_, unit) => scenario.fleet.ambulances + unit + 1);
  const available = new Uint8Array(count);
  const cell = new Int32Array(count).fill(-1);
  const x = new Float32Array(count);
  const z = new Float32Array(count);
  for (let unit = 0; unit < count && roads.length > 0; unit++) {
    const spawn = roads[unit % roads.length];
    available[unit] = 1;
    cell[unit] = spawn;
    x[unit] = spawn % world.width + 0.5;
    z[unit] = Math.floor(spawn / world.width) + 0.5;
  }
  return {
    count,
    id,
    available,
    state: new Uint8Array(count).fill(VehicleState.Idle),
    cell,
    x,
    z,
    heading: new Float32Array(count),
    assignment: new Int32Array(count).fill(-1),
    taskKind: new Uint8Array(count),
    taskSubject: new Int32Array(count).fill(-1),
    escortArrived: new Uint8Array(count),
    criticalCrowdActive: new Uint8Array(length),
    target: new Int32Array(count).fill(-1),
    routes: Array.from({ length: count }, () => null),
  };
}

export function planPoliceRoute(system: PoliceSystem, unit: number, target: number, world: World, scenario: Scenario, blocked: Uint8Array, navVersion: number): boolean {
  if (!Number.isInteger(unit) || unit < 0 || unit >= system.count || !system.available[unit]) return false;
  const path = findPath(buildHazardGrid(world, scenario, "car", blocked), system.cell[unit], target);
  if (!path) {
    system.routes[unit] = null;
    system.target[unit] = -1;
    system.assignment[unit] = -1;
    system.taskKind[unit] = PoliceTaskKind.None;
    system.taskSubject[unit] = -1;
    system.state[unit] = VehicleState.Idle;
    return false;
  }
  system.target[unit] = target;
  system.routes[unit] = { cells: Int32Array.from(path), cursor: 1, target, navVersion };
  system.state[unit] = path.length > 1 ? VehicleState.Moving : VehicleState.Idle;
  return true;
}

export function stepPolice(
  system: PoliceSystem,
  traffic: TrafficState,
  world: World,
  scenario: Scenario,
  blocked: Uint8Array,
  navVersion: number,
  tick: number,
  escortCandidates: readonly PoliceTaskCandidate[] = [],
  crowdCandidates: readonly CrowdTaskCandidate[] = [],
): { events: SimEvent[]; controlled: Uint8Array; escortGuidance: ReadonlySet<number>; crowdGuidance: Uint8Array } {
  const events: SimEvent[] = [];
  const controlled = new Uint8Array(world.width * world.height);
  const crowdGuidance = new Uint8Array(world.width * world.height);
  const candidates: PoliceDispatchCandidate[] = [...escortCandidates, ...crowdCandidates];
  const currentCritical = new Uint8Array(system.criticalCrowdActive.length);
  for (const candidate of crowdCandidates) if (candidate.critical && candidate.assignmentCell >= 0 && candidate.assignmentCell < currentCritical.length) currentCritical[candidate.assignmentCell] = 1;

  // Clear assignments whose incidents are no longer gridlocked before any
  // new work is considered. A unit at scene is available again immediately.
  for (let unit = 0; unit < system.count; unit++) {
    const assigned = system.assignment[unit];
    const kind = system.taskKind[unit] as PoliceTaskKind;
    if (assigned < 0 || kind === PoliceTaskKind.Escort && escortCandidates.some((candidate) => candidate.subject === system.taskSubject[unit]) || kind === PoliceTaskKind.CrowdControl && crowdCandidates.some((candidate) => candidate.assignmentCell === assigned) || kind === PoliceTaskKind.TrafficControl && traffic.gridlock[assigned] === 1) continue;
    events.push({
      tick,
      type: "COMMIT_CANCELLED",
      actor: system.id[unit] as VehicleId,
      actorKind: "vehicle",
      cell: assigned,
    reason: kind === PoliceTaskKind.Escort ? "Civilian escort group is no longer eligible; police assignment released" : kind === PoliceTaskKind.CrowdControl ? "Crowd pressure cleared; police crowd-control assignment released" : "Gridlock cleared at the assigned intersection; police traffic-control assignment released",
    });
    clearAssignment(system, unit);
  }

  // A newly activated critical crowd task is the sole exception to stable
  // ownership. Displace one lowest-priority non-critical assignment per task.
  const newlyCritical = crowdCandidates.filter((candidate) => candidate.critical && candidate.assignmentCell >= 0 && candidate.assignmentCell < system.criticalCrowdActive.length && system.criticalCrowdActive[candidate.assignmentCell] !== 1 &&
    !Array.from({ length: system.count }, (_, unit) => system.taskKind[unit] === PoliceTaskKind.CrowdControl && system.assignment[unit] === candidate.assignmentCell).some(Boolean))
    .sort(compareCandidates);
  let idleUnits = 0;
  for (let unit = 0; unit < system.count; unit++) if (system.available[unit] === 1 && system.assignment[unit] < 0 && system.state[unit] === VehicleState.Idle) idleUnits++;
  for (const candidate of newlyCritical) {
    if (idleUnits > 0) { idleUnits--; continue; }
    let displaced = -1;
    for (let unit = 0; unit < system.count; unit++) {
      if (!system.available[unit] || system.assignment[unit] < 0 || system.taskKind[unit] === PoliceTaskKind.None ||
          system.taskKind[unit] === PoliceTaskKind.CrowdControl && crowdCandidates.some((item) => item.assignmentCell === system.assignment[unit] && item.critical)) continue;
      if (displaced < 0 || compareAssignedPriority(system, unit, displaced, traffic, escortCandidates, crowdCandidates) > 0) displaced = unit;
    }
    if (displaced < 0) continue;
    const cell = system.assignment[displaced];
    events.push({ tick, type: "COMMIT_CANCELLED", actor: system.id[displaced] as VehicleId, actorKind: "vehicle", cell,
      reason: `Police assignment preempted for newly active critical crowd-control task at ${candidate.assignmentCell}; prior job remains eligible for retry` });
    clearAssignment(system, displaced);
  }

  const orderedCandidates = candidates.slice().sort(compareCandidates);
  for (const candidate of orderedCandidates) {
    const existingUnit = system.assignment.findIndex((assignment, unit) => system.available[unit] === 1 &&
      system.taskKind[unit] === candidate.kind && assignment === candidate.assignmentCell &&
      (candidate.kind !== PoliceTaskKind.Escort || system.taskSubject[unit] === candidate.subject));
    if (existingUnit >= 0) {
      system.assignment[existingUnit] = candidate.assignmentCell;
      if (system.target[existingUnit] !== candidate.targetCell) {
        system.escortArrived[existingUnit] = 0;
        if (!planPoliceRoute(system, existingUnit, candidate.targetCell, world, scenario, blocked, navVersion)) {
          clearAssignment(system, existingUnit);
          events.push({ tick, type: "COMMIT_CANCELLED", actor: system.id[existingUnit] as VehicleId, actorKind: "vehicle", cell: candidate.assignmentCell,
            reason: candidate.kind === PoliceTaskKind.Escort ? "Police escort roadside waypoint became unreachable; assignment released for retry" : "Police crowd-control point became unreachable; assignment released for retry" });
        }
      }
      continue;
    }
    let unit = -1;
    for (let candidateUnit = 0; candidateUnit < system.count; candidateUnit++) {
      if (!system.available[candidateUnit] || system.state[candidateUnit] !== VehicleState.Idle || system.assignment[candidateUnit] !== -1 || system.target[candidateUnit] !== -1 || system.routes[candidateUnit] !== null) continue;
      const path = findPath(buildHazardGrid(world, scenario, "car", blocked), system.cell[candidateUnit], candidate.targetCell);
      if (!path) continue;
      unit = candidateUnit;
      system.assignment[unit] = candidate.assignmentCell;
      system.taskKind[unit] = candidate.kind;
      system.taskSubject[unit] = candidate.kind === PoliceTaskKind.Escort ? candidate.subject : -1;
      system.escortArrived[unit] = 0;
      system.target[unit] = candidate.targetCell;
      system.routes[unit] = { cells: Int32Array.from(path), cursor: 1, target: candidate.targetCell, navVersion };
      system.state[unit] = path.length > 1 ? VehicleState.Moving : VehicleState.Idle;
      events.push(candidate.kind === PoliceTaskKind.Escort
        ? { tick, type: "ASSIGNED", actor: system.id[unit] as VehicleId, actorKind: "vehicle", target: candidate.civilianId as SimEvent["target"], targetKind: "npc", cell: candidate.assignmentCell, data: { targetCell: candidate.targetCell }, reason: "Police vehicle assigned to guide an evacuating civilian group along its existing safe route" }
        : { tick, type: "ASSIGNED", actor: system.id[unit] as VehicleId, actorKind: "vehicle", cell: candidate.assignmentCell, data: { targetCell: candidate.targetCell }, reason: `Police vehicle assigned to guide crowd movement at hotspot ${candidate.assignmentCell}` });
      break;
    }
  }

  const owned = new Uint8Array(traffic.gridlock.length);
  let remainingUnits = 0;
  for (let unit = 0; unit < system.count; unit++) {
    const assigned = system.assignment[unit];
    if (system.taskKind[unit] === PoliceTaskKind.TrafficControl && assigned >= 0 && assigned < owned.length) owned[assigned] = 1;
    if (system.available[unit] && system.state[unit] === VehicleState.Idle && assigned === -1 &&
        system.target[unit] === -1 && system.routes[unit] === null) remainingUnits++;
  }
  if (remainingUnits > 0) {
    const eligible: number[] = [];
    for (let cell = 0; cell < traffic.gridlock.length; cell++) {
      if (traffic.intersections[cell] === 1 && traffic.gridlock[cell] === 1 && owned[cell] === 0) eligible.push(cell);
    }
    eligible.sort((a, b) => traffic.waited[b] - traffic.waited[a] ||
      traffic.lastDemand[b] - traffic.lastDemand[a] || a - b);

    const hazardGrid = buildHazardGrid(world, scenario, "car", blocked);
    for (const target of eligible) {
      let selected = -1;
      let selectedPath: number[] | null = null;
      for (let unit = 0; unit < system.count; unit++) {
        if (!system.available[unit] || system.state[unit] !== VehicleState.Idle ||
            system.assignment[unit] !== -1 || system.target[unit] !== -1 || system.routes[unit] !== null) continue;
        const path = findPath(hazardGrid, system.cell[unit], target);
        if (!path) continue;
        if (selectedPath === null || path.length < selectedPath.length ||
            (path.length === selectedPath.length && system.id[unit] < system.id[selected])) {
          selected = unit;
          selectedPath = path;
        }
      }
      if (selected < 0 || selectedPath === null) continue;
      system.assignment[selected] = target;
      system.taskKind[selected] = PoliceTaskKind.TrafficControl;
      system.taskSubject[selected] = -1;
      system.target[selected] = target;
      system.routes[selected] = { cells: Int32Array.from(selectedPath), cursor: 1, target, navVersion };
      system.state[selected] = selectedPath.length > 1 ? VehicleState.Moving : VehicleState.Idle;
      owned[target] = 1;
      remainingUnits--;
      events.push({
        tick,
        type: "ASSIGNED",
        actor: system.id[selected] as VehicleId,
        actorKind: "vehicle",
        cell: target,
        data: { targetCell: target },
        reason: `Police vehicle dispatched to gridlocked intersection ${target}`,
      });
      if (remainingUnits === 0) break;
    }
  }

  for (let unit = 0; unit < system.count; unit++) {
    if (!system.available[unit]) continue;
    let route = system.routes[unit];
    if (!route) continue;
    if (route.navVersion !== navVersion) {
      if (!planPoliceRoute(system, unit, route.target, world, scenario, blocked, navVersion)) {
        system.taskKind[unit] = PoliceTaskKind.None;
        system.taskSubject[unit] = -1;
        events.push({ tick, type: "COMMIT_CANCELLED", actor: system.id[unit] as VehicleId, actorKind: "vehicle", cell: route.target, reason: "Police vehicle route became unreachable after the road graph changed; assignment released for retry" });
        continue;
      }
      route = system.routes[unit];
      if (!route) continue;
    }
    if (route.cursor >= route.cells.length) {
      system.state[unit] = VehicleState.Idle;
      system.routes[unit] = null;
      if (system.assignment[unit] === -1) system.target[unit] = -1;
      continue;
    }
    const next = route.cells[route.cursor];
    if (!canEnter(world, scenario, "car", next, blocked)) {
      system.routes[unit] = null;
      system.target[unit] = -1;
      system.assignment[unit] = -1;
      system.taskKind[unit] = PoliceTaskKind.None;
      system.taskSubject[unit] = -1;
      system.escortArrived[unit] = 0;
      system.state[unit] = VehicleState.Idle;
      events.push({ tick, type: "COMMIT_CANCELLED", actor: system.id[unit] as VehicleId, actorKind: "vehicle", cell: route.target, reason: "Police vehicle route became unsafe; assignment released for retry" });
      continue;
    }
    assertMovementEntry(world, system.cell[unit], next, "car", blocked);
    const dx = next % world.width - system.cell[unit] % world.width;
    const dz = Math.floor(next / world.width) - Math.floor(system.cell[unit] / world.width);
    system.cell[unit] = next;
    system.x[unit] = next % world.width + 0.5;
    system.z[unit] = Math.floor(next / world.width) + 0.5;
    system.heading[unit] = Math.atan2(dx, dz);
    route.cursor++;
    if (route.cursor >= route.cells.length) {
      system.state[unit] = VehicleState.Idle;
      system.routes[unit] = null;
      if (system.assignment[unit] === -1) system.target[unit] = -1;
    }
  }
  for (let unit = 0; unit < system.count; unit++) {
    const target = system.assignment[unit];
    if (system.taskKind[unit] === PoliceTaskKind.TrafficControl && target >= 0 && system.cell[unit] === target && traffic.gridlock[target] === 1) controlled[target] = 1;
  }
  const escortGuidance = new Set<number>();
  for (let unit = 0; unit < system.count; unit++) {
    if (!system.available[unit] || system.assignment[unit] < 0) continue;
    if (system.taskKind[unit] === PoliceTaskKind.CrowdControl && system.cell[unit] === system.target[unit]) {
      crowdGuidance[system.assignment[unit]] = 1;
      if (!system.escortArrived[unit]) {
        events.push({ tick, type: "ARRIVED", actor: system.id[unit] as VehicleId, actorKind: "vehicle", cell: system.assignment[unit], reason: `Police vehicle reached the safe roadside control point for crowd hotspot ${system.assignment[unit]}` });
        system.escortArrived[unit] = 1;
      }
      continue;
    }
    if (system.taskKind[unit] !== PoliceTaskKind.Escort) continue;
    const candidate = escortCandidates.find((item) => item.subject === system.taskSubject[unit]);
    if (!candidate || system.cell[unit] !== system.target[unit]) continue;
    for (const member of candidate.members) escortGuidance.add(member);
    if (!system.escortArrived[unit]) {
      events.push({ tick, type: "ARRIVED", actor: system.id[unit] as VehicleId, actorKind: "vehicle", target: candidate.civilianId as SimEvent["target"], targetKind: "npc", cell: system.cell[unit], reason: "Police escort reached a safe roadside waypoint beside the civilian group's existing route" });
      system.escortArrived[unit] = 1;
    }
  }
  system.criticalCrowdActive.fill(0);
  for (let unit = 0; unit < system.count; unit++) {
    if (system.taskKind[unit] === PoliceTaskKind.CrowdControl && crowdCandidates.some((candidate) =>
      candidate.assignmentCell === system.assignment[unit] && candidate.critical)) {
      system.criticalCrowdActive[system.assignment[unit]] = 1;
    }
  }
  return { events, controlled, escortGuidance, crowdGuidance };
}

function clearAssignment(system: PoliceSystem, unit: number): void {
  system.assignment[unit] = -1;
  system.taskKind[unit] = PoliceTaskKind.None;
  system.taskSubject[unit] = -1;
  system.escortArrived[unit] = 0;
  system.target[unit] = -1;
  system.routes[unit] = null;
  system.state[unit] = VehicleState.Idle;
}

function candidateTier(candidate: PoliceDispatchCandidate): number {
  if (candidate.kind === PoliceTaskKind.CrowdControl) return candidate.critical ? 0 : 2;
  return candidate.urgency >= 1000 ? 1 : 3;
}

function compareCandidates(a: PoliceDispatchCandidate, b: PoliceDispatchCandidate): number {
  return candidateTier(a) - candidateTier(b) || b.urgency - a.urgency ||
    a.assignmentCell - b.assignmentCell || a.subject - b.subject;
}

function taskTier(system: PoliceSystem, unit: number, escorts: readonly PoliceTaskCandidate[], crowds: readonly CrowdTaskCandidate[]): number {
  const kind = system.taskKind[unit] as PoliceTaskKind;
  if (kind === PoliceTaskKind.CrowdControl) return Boolean(crowds.find((candidate) => candidate.assignmentCell === system.assignment[unit])?.critical) ? 0 : 2;
  if (kind === PoliceTaskKind.Escort) return (escorts.find((candidate) => candidate.subject === system.taskSubject[unit])?.urgency ?? 0) >= 1000 ? 1 : 3;
  return 4;
}

function compareAssignedPriority(system: PoliceSystem, a: number, b: number, traffic: TrafficState,
  escorts: readonly PoliceTaskCandidate[], crowds: readonly CrowdTaskCandidate[]): number {
  const tierA = taskTier(system, a, escorts, crowds);
  const tierB = taskTier(system, b, escorts, crowds);
  if (tierA !== tierB) return tierA - tierB;
  const candidateA = system.taskKind[a] === PoliceTaskKind.Escort
    ? escorts.find((candidate) => candidate.subject === system.taskSubject[a])
    : system.taskKind[a] === PoliceTaskKind.CrowdControl
      ? crowds.find((candidate) => candidate.assignmentCell === system.assignment[a]) : undefined;
  const candidateB = system.taskKind[b] === PoliceTaskKind.Escort
    ? escorts.find((candidate) => candidate.subject === system.taskSubject[b])
    : system.taskKind[b] === PoliceTaskKind.CrowdControl
      ? crowds.find((candidate) => candidate.assignmentCell === system.assignment[b]) : undefined;
  if (candidateA && candidateB) {
    return candidateB.urgency - candidateA.urgency || candidateA.assignmentCell - candidateB.assignmentCell ||
      candidateA.subject - candidateB.subject || system.id[a] - system.id[b];
  }
  return traffic.waited[system.assignment[b]] - traffic.waited[system.assignment[a]] ||
    traffic.lastDemand[system.assignment[b]] - traffic.lastDemand[system.assignment[a]] ||
    system.assignment[a] - system.assignment[b] || system.id[a] - system.id[b];
}

export function policeSnapshot(system: PoliceSystem): {
  id: Int32Array; x: Float32Array; z: Float32Array; heading: Float32Array; kind: Uint8Array; state: Uint8Array;
} {
  const indices: number[] = [];
  for (let unit = 0; unit < system.count; unit++) if (system.available[unit]) indices.push(unit);
  return {
    id: Int32Array.from(indices, (unit) => system.id[unit]),
    x: Float32Array.from(indices, (unit) => system.x[unit]),
    z: Float32Array.from(indices, (unit) => system.z[unit]),
    heading: Float32Array.from(indices, (unit) => system.heading[unit]),
    kind: new Uint8Array(indices.length).fill(VehicleKind.PoliceCar),
    state: Uint8Array.from(indices, (unit) => system.state[unit]),
  };
}
