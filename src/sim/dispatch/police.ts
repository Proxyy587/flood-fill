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
): { events: SimEvent[]; controlled: Uint8Array } {
  void traffic; // Traffic selection/control is intentionally reserved for the next slice.
  const events: SimEvent[] = [];
  const controlled = new Uint8Array(world.width * world.height);
  for (let unit = 0; unit < system.count; unit++) {
    if (!system.available[unit]) continue;
    let route = system.routes[unit];
    if (!route) continue;
    if (route.navVersion !== navVersion) {
      if (!planPoliceRoute(system, unit, route.target, world, scenario, blocked, navVersion)) {
        events.push({ tick, type: "COMMIT_CANCELLED", actor: system.id[unit] as VehicleId, actorKind: "vehicle", reason: "Police vehicle route became unreachable after the road graph changed; assignment released for retry" });
        continue;
      }
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
      system.target[unit] = -1;
      system.assignment[unit] = -1;
      system.state[unit] = VehicleState.Idle;
      events.push({ tick, type: "COMMIT_CANCELLED", actor: system.id[unit] as VehicleId, actorKind: "vehicle", cell: system.cell[unit], reason: "Police vehicle route became unsafe; assignment released for retry" });
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
  return { events, controlled };
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
