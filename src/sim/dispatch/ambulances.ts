import { BlockType, VehicleKind, VehicleState } from "../../contracts/types";
import type { BuildingDef, Scenario } from "../../contracts/types";
import { assertMovementEntry } from "../invariants/movement";
import { buildHazardGrid, canEnter } from "../nav/hazards";
import { findPath } from "../nav";
import type { World } from "../world/grid";

export interface AmbulanceRoute {
  cells: Int32Array;
  cursor: number;
  target: number;
  navVersion: number;
}

export interface AmbulanceSystem {
  count: number;
  id: Int32Array;
  available: Uint8Array;
  state: Uint8Array;
  cell: Int32Array;
  x: Float32Array;
  z: Float32Array;
  heading: Float32Array;
  assignment: Int32Array;
  patientAssignment: Int32Array;
  target: Int32Array;
  routes: (AmbulanceRoute | null)[];
}

function safeRoadCells(world: World, scenario: Scenario, blocked: Uint8Array): number[] {
  const cells: number[] = [];
  for (let cell = 0; cell < world.block.length; cell++) {
    if ((world.block[cell] === BlockType.Road || world.block[cell] === BlockType.Bridge) && canEnter(world, scenario, "car", cell, blocked)) cells.push(cell);
  }
  return cells;
}

function distance(a: number, b: number, width: number): number {
  return Math.abs(a % width - b % width) + Math.abs(Math.floor(a / width) - Math.floor(b / width));
}

export function nearestSafeRoadRoute(fromCell: number, targetCell: number, world: World, scenario: Scenario, blocked: Uint8Array, maxAccessDistance = Infinity): { accessCell: number; route: Int32Array } | undefined {
  if (!Number.isInteger(targetCell) || targetCell < 0 || targetCell >= world.width * world.height) throw new RangeError("Target cell is outside the ambulance map");
  if (!(maxAccessDistance >= 0) || Number.isNaN(maxAccessDistance)) throw new RangeError("Maximum ambulance access distance must be nonnegative");
  const grid = buildHazardGrid(world, scenario, "car", blocked);
  const roads = safeRoadCells(world, scenario, blocked).sort((a, b) => distance(a, targetCell, world.width) - distance(b, targetCell, world.width) || a - b);
  let best: { accessCell: number; route: Int32Array; distance: number; eta: number } | undefined;
  for (const accessCell of roads) {
    const geometricDistance = distance(accessCell, targetCell, world.width);
    if (geometricDistance > maxAccessDistance) break;
    if (best && geometricDistance > best.distance) break;
    const path = findPath(grid, fromCell, accessCell);
    if (!path) continue;
    if (!best || path.length < best.eta || path.length === best.eta && accessCell < best.accessCell) {
      best = { accessCell, route: Int32Array.from(path), distance: geometricDistance, eta: path.length };
    }
  }
  if (!best) return undefined;
  return { accessCell: best.accessCell, route: best.route };
}

function safeHospitalAccess(world: World, scenario: Scenario, blocked: Uint8Array, roads: readonly number[]): number[] {
  const result: { cell: number; hospital: BuildingDef; distance: number }[] = [];
  for (const hospital of scenario.buildings) {
    if (hospital.type !== BlockType.Hospital || hospital.capacity <= 0 || world.powered[hospital.entrance] === 0 ||
        hospital.cells.some((cell) => world.water[cell] > hospital.floorHeight)) continue;
    for (const cell of roads) {
      if (distance(cell, hospital.entrance, world.width) === 1 && canEnter(world, scenario, "car", cell, blocked)) {
        result.push({ cell, hospital, distance: 1 });
      }
    }
  }
  return result.sort((a, b) => a.hospital.id - b.hospital.id || a.distance - b.distance || a.cell - b.cell).map((entry) => entry.cell);
}

function initialCell(world: World, scenario: Scenario, blocked: Uint8Array, roads: readonly number[]): number {
  const hospitalAccess = safeHospitalAccess(world, scenario, blocked, roads);
  if (hospitalAccess.length) return hospitalAccess[0];
  const hq = scenario.buildings.filter((building) => building.type === BlockType.FloodHQ).sort((a, b) => a.id - b.id)[0];
  if (hq && roads.length) {
    return [...roads].sort((a, b) => distance(a, hq.entrance, world.width) - distance(b, hq.entrance, world.width) || a - b)[0];
  }
  return roads[0] ?? -1;
}

export function createAmbulances(scenario: Scenario, world: World, blocked: Uint8Array): AmbulanceSystem {
  if (blocked.length !== world.width * world.height) throw new RangeError("Blocked mask must match the ambulance map");
  const count = scenario.fleet.ambulances;
  const cell = initialCell(world, scenario, blocked, safeRoadCells(world, scenario, blocked));
  const available = new Uint8Array(count);
  const locations = new Int32Array(count).fill(-1);
  const x = new Float32Array(count);
  const z = new Float32Array(count);
  if (cell >= 0) {
    available.fill(1);
    locations.fill(cell);
    for (let unit = 0; unit < count; unit++) {
      x[unit] = cell % world.width + 0.5;
      z[unit] = Math.floor(cell / world.width) + 0.5;
    }
  }
  return {
    count,
    id: Int32Array.from({ length: count }, (_, index) => index + 1),
    available,
    state: new Uint8Array(count).fill(VehicleState.Idle),
    cell: locations,
    x,
    z,
    heading: new Float32Array(count),
    assignment: new Int32Array(count).fill(-1),
    patientAssignment: new Int32Array(count).fill(-1),
    target: new Int32Array(count).fill(-1),
    routes: Array.from({ length: count }, () => null),
  };
}

export function planAmbulanceRoute(system: AmbulanceSystem, unit: number, target: number, world: World, scenario: Scenario, blocked: Uint8Array, navVersion: number): boolean {
  if (!Number.isInteger(unit) || unit < 0 || unit >= system.count || !system.available[unit]) return false;
  const path = findPath(buildHazardGrid(world, scenario, "car", blocked), system.cell[unit], target);
  if (!path) {
    system.routes[unit] = null;
    system.target[unit] = -1;
    system.state[unit] = VehicleState.Idle;
    return false;
  }
  system.target[unit] = target;
  system.routes[unit] = { cells: Int32Array.from(path), cursor: 1, target, navVersion };
  system.state[unit] = path.length > 1 ? VehicleState.Moving : VehicleState.Idle;
  return true;
}

export function stepAmbulances(system: AmbulanceSystem, world: World, scenario: Scenario, blocked: Uint8Array, navVersion: number): void {
  for (let unit = 0; unit < system.count; unit++) {
    if (!system.available[unit]) continue;
    let route = system.routes[unit];
    if (!route) continue;
    if (route.navVersion !== navVersion) {
      if (!planAmbulanceRoute(system, unit, route.target, world, scenario, blocked, navVersion)) continue;
      route = system.routes[unit];
      if (!route) continue;
    }
    if (route.cursor >= route.cells.length) {
      system.state[unit] = VehicleState.Idle;
      system.routes[unit] = null;
      system.target[unit] = -1;
      continue;
    }
    const next = route.cells[route.cursor];
    if (!canEnter(world, scenario, "car", next, blocked)) {
      system.routes[unit] = null;
      system.state[unit] = VehicleState.Idle;
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
      system.target[unit] = -1;
    }
  }
}

export function ambulanceSnapshot(system: AmbulanceSystem): {
  id: Int32Array; x: Float32Array; z: Float32Array; heading: Float32Array; kind: Uint8Array; state: Uint8Array;
} {
  const indices: number[] = [];
  for (let unit = 0; unit < system.count; unit++) if (system.available[unit]) indices.push(unit);
  return {
    id: Int32Array.from(indices, (unit) => system.id[unit]),
    x: Float32Array.from(indices, (unit) => system.x[unit]),
    z: Float32Array.from(indices, (unit) => system.z[unit]),
    heading: Float32Array.from(indices, (unit) => system.heading[unit]),
    kind: new Uint8Array(indices.length).fill(VehicleKind.Ambulance),
    state: Uint8Array.from(indices, (unit) => system.state[unit]),
  };
}
