import { BlockType, VehicleKind, VehicleState } from "../../contracts/types";
import type { Scenario } from "../../contracts/types";
import { assertMovementEntry } from "../invariants/movement";
import { buildHazardGrid, canEnter } from "../nav/hazards";
import { findPath } from "../nav";
import type { World } from "../world/grid";

export const BOAT_SEATS = 4;

export interface BoatRoute {
  cells: Int32Array;
  cursor: number;
  target: number;
  navVersion: number;
}

export interface BoatSystem {
  count: number;
  id: Int32Array;
  available: Uint8Array;
  state: Uint8Array;
  cell: Int32Array;
  x: Float32Array;
  z: Float32Array;
  heading: Float32Array;
  assignment: Int32Array;
  passengers: Int32Array;
  passengerCount: Uint8Array;
  target: Int32Array;
  routes: (BoatRoute | null)[];
}

function adjacent(cell: number, width: number, height: number): number[] {
  const x = cell % width;
  const z = Math.floor(cell / width);
  const result: number[] = [];
  if (z > 0) result.push(cell - width);
  if (x + 1 < width) result.push(cell + 1);
  if (z + 1 < height) result.push(cell + width);
  if (x > 0) result.push(cell - 1);
  return result.sort((a, b) => a - b);
}

function launchCells(world: World, scenario: Scenario, blocked: Uint8Array): number[] {
  const cells = new Set<number>();
  for (const depot of scenario.buildings.filter((building) => building.type === BlockType.BoatDepot).sort((a, b) => a.id - b.id)) {
    for (const depotCell of [...depot.cells].sort((a, b) => a - b)) {
      for (const cell of adjacent(depotCell, world.width, world.height)) {
        const block = world.block[cell];
        const obstacle = block === BlockType.Bridge || block === BlockType.Tree || block === BlockType.Levee || world.buildingId[cell] !== 0 ||
          block >= BlockType.House && block <= BlockType.Substation;
        if (!blocked[cell] && !obstacle) cells.add(cell);
      }
    }
  }
  return [...cells].sort((a, b) => Number(canEnter(world, scenario, "boat", b, blocked)) - Number(canEnter(world, scenario, "boat", a, blocked)) || a - b);
}

export function createBoats(scenario: Scenario, world: World, blocked: Uint8Array): BoatSystem {
  const length = world.width * world.height;
  if (blocked.length !== length) throw new RangeError("Blocked mask must match the boat map");
  const count = Math.min(scenario.fleet.boats, scenario.fleet.boatOperators);
  const launches = launchCells(world, scenario, blocked);
  const locations = new Int32Array(count).fill(-1);
  const available = new Uint8Array(count);
  const x = new Float32Array(count);
  const z = new Float32Array(count);
  for (let boat = 0; boat < Math.min(count, launches.length); boat++) {
    const cell = launches[boat];
    locations[boat] = cell;
    available[boat] = 1;
    x[boat] = cell % world.width + 0.5;
    z[boat] = Math.floor(cell / world.width) + 0.5;
  }
  const firstId = scenario.fleet.ambulances + scenario.fleet.policeCars + 1;
  return {
    count,
    id: Int32Array.from({ length: count }, (_, boat) => firstId + boat),
    available,
    state: new Uint8Array(count).fill(VehicleState.Idle),
    cell: locations,
    x,
    z,
    heading: new Float32Array(count),
    assignment: new Int32Array(count).fill(-1),
    passengers: new Int32Array(count * BOAT_SEATS).fill(-1),
    passengerCount: new Uint8Array(count),
    target: new Int32Array(count).fill(-1),
    routes: Array.from({ length: count }, () => null),
  };
}

export function loadBoatPassenger(system: BoatSystem, boat: number, patient: number): boolean {
  if (!Number.isInteger(boat) || boat < 0 || boat >= system.count || !Number.isInteger(patient) || patient < 0) throw new RangeError("Boat or passenger index is invalid");
  if (!system.available[boat] || system.passengerCount[boat] >= BOAT_SEATS) return false;
  const start = boat * BOAT_SEATS;
  for (let slot = 0; slot < system.passengerCount[boat]; slot++) if (system.passengers[start + slot] === patient) return false;
  system.passengers[start + system.passengerCount[boat]] = patient;
  system.passengerCount[boat]++;
  return true;
}

export function planBoatRoute(system: BoatSystem, boat: number, target: number, world: World, scenario: Scenario, blocked: Uint8Array, navVersion: number): boolean {
  if (!Number.isInteger(boat) || boat < 0 || boat >= system.count || !system.available[boat]) return false;
  const path = findPath(buildHazardGrid(world, scenario, "boat", blocked), system.cell[boat], target);
  if (!path) {
    system.routes[boat] = null;
    system.target[boat] = -1;
    system.state[boat] = VehicleState.Idle;
    return false;
  }
  system.target[boat] = target;
  system.routes[boat] = { cells: Int32Array.from(path), cursor: 1, target, navVersion };
  system.state[boat] = path.length > 1 ? VehicleState.Moving : VehicleState.Idle;
  return true;
}

export function stepBoats(system: BoatSystem, world: World, scenario: Scenario, blocked: Uint8Array, navVersion: number): void {
  for (let boat = 0; boat < system.count; boat++) {
    if (!system.available[boat]) continue;
    let route = system.routes[boat];
    if (!route) continue;
    if (route.navVersion !== navVersion) {
      if (!planBoatRoute(system, boat, route.target, world, scenario, blocked, navVersion)) continue;
      route = system.routes[boat];
      if (!route) continue;
    }
    if (route.cursor >= route.cells.length) {
      system.state[boat] = VehicleState.Idle;
      system.routes[boat] = null;
      system.target[boat] = -1;
      continue;
    }
    const next = route.cells[route.cursor];
    if (!canEnter(world, scenario, "boat", next, blocked)) {
      system.routes[boat] = null;
      system.state[boat] = VehicleState.Idle;
      continue;
    }
    assertMovementEntry(world, system.cell[boat], next, "boat", blocked);
    const dx = next % world.width - system.cell[boat] % world.width;
    const dz = Math.floor(next / world.width) - Math.floor(system.cell[boat] / world.width);
    system.cell[boat] = next;
    system.x[boat] = next % world.width + 0.5;
    system.z[boat] = Math.floor(next / world.width) + 0.5;
    system.heading[boat] = Math.atan2(dx, dz);
    route.cursor++;
    if (route.cursor >= route.cells.length) {
      system.state[boat] = VehicleState.Idle;
      system.routes[boat] = null;
      system.target[boat] = -1;
    }
  }
}

export function boatSnapshot(system: BoatSystem): {
  id: Int32Array; x: Float32Array; z: Float32Array; heading: Float32Array; kind: Uint8Array; state: Uint8Array;
} {
  const indices: number[] = [];
  for (let boat = 0; boat < system.count; boat++) if (system.available[boat]) indices.push(boat);
  return {
    id: Int32Array.from(indices, (boat) => system.id[boat]),
    x: Float32Array.from(indices, (boat) => system.x[boat]),
    z: Float32Array.from(indices, (boat) => system.z[boat]),
    heading: Float32Array.from(indices, (boat) => system.heading[boat]),
    kind: new Uint8Array(indices.length).fill(VehicleKind.Boat),
    state: Uint8Array.from(indices, (boat) => system.state[boat]),
  };
}
