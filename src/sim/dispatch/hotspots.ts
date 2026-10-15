import { BlockType, VehicleState } from "../../contracts/types";
import type { Scenario } from "../../contracts/types";
import { planAmbulanceRoute } from "./ambulances";
import type { AmbulanceSystem } from "./ambulances";
import type { HospitalSystem } from "./hospitals";
import { buildHazardGrid, canEnter } from "../nav/hazards";
import { buildFlowField } from "../nav";
import type { World } from "../world/grid";

const REGION_SIZE = 8;
const HISTORY_TICKS = 120;

export interface HotspotDemand {
  cell: number;
  severe: boolean;
  uncovered: boolean;
}

export interface HotspotAdmission {
  cell: number;
  severe: boolean;
}

export interface HotspotSystem {
  width: number;
  height: number;
  columns: number;
  rows: number;
  score: Int32Array;
  history: Int32Array;
  slotTick: Int32Array;
  lastTick: number;
}

export function createHotspotSystem(width: number, height: number): HotspotSystem {
  if (!Number.isSafeInteger(width) || width < 1 || width > 128 || !Number.isSafeInteger(height) || height < 1 || height > 128) {
    throw new RangeError("Hotspot dimensions must be integers in [1,128]");
  }
  const columns = Math.ceil(width / REGION_SIZE);
  const rows = Math.ceil(height / REGION_SIZE);
  const zones = columns * rows;
  return { width, height, columns, rows, score: new Int32Array(zones), history: new Int32Array(zones * HISTORY_TICKS),
    slotTick: new Int32Array(HISTORY_TICKS).fill(-1), lastTick: -1 };
}

export function hotspotZoneForCell(system: HotspotSystem, cell: number): number {
  if (!Number.isInteger(cell) || cell < 0 || cell >= system.width * system.height) throw new RangeError("Hotspot cell is outside the map");
  const x = cell % system.width;
  const z = Math.floor(cell / system.width);
  return Math.floor(z / REGION_SIZE) * system.columns + Math.floor(x / REGION_SIZE);
}

export function updateHotspots(system: HotspotSystem, demands: readonly HotspotDemand[], admissions: readonly HotspotAdmission[], tick: number): void {
  if (!Number.isSafeInteger(tick) || tick < system.lastTick) throw new RangeError("Hotspot ticks must be nonnegative and monotonic");
  const slot = tick % HISTORY_TICKS;
  for (let index = 0; index < system.score.length; index++) system.history[index * HISTORY_TICKS + slot] = 0;
  system.slotTick[slot] = tick;
  for (const admission of admissions) {
    const zone = hotspotZoneForCell(system, admission.cell);
    if (!admission.severe) continue;
    system.history[zone * HISTORY_TICKS + slot]++;
  }
  system.score.fill(0);
  for (const demand of demands) {
    const zone = hotspotZoneForCell(system, demand.cell);
    if (demand.severe && demand.uncovered) system.score[zone] += 2;
  }
  for (let age = 0; age < HISTORY_TICKS; age++) {
    const historyTick = tick - age;
    if (historyTick < 0) break;
    const historySlot = historyTick % HISTORY_TICKS;
    if (system.slotTick[historySlot] !== historyTick) continue;
    for (let zone = 0; zone < system.score.length; zone++) system.score[zone] += system.history[zone * HISTORY_TICKS + historySlot];
  }
  system.lastTick = tick;
}

function accessRoads(world: World, scenario: Scenario, hospitalIndex: number, hospitals: HospitalSystem, blocked: Uint8Array): number[] {
  const hospital = scenario.buildings.find((building) => building.id === hospitals.id[hospitalIndex]);
  if (!hospital) return [];
  const entrance = hospital.entrance;
  const x = entrance % world.width;
  const z = Math.floor(entrance / world.width);
  const neighbours: number[] = [];
  if (z > 0) neighbours.push(entrance - world.width);
  if (x + 1 < world.width) neighbours.push(entrance + 1);
  if (z + 1 < world.height) neighbours.push(entrance + world.width);
  if (x > 0) neighbours.push(entrance - 1);
  return neighbours.filter((cell) => (world.block[cell] === BlockType.Road || world.block[cell] === BlockType.Bridge) && canEnter(world, scenario, "car", cell, blocked)).sort((a, b) => a - b);
}

function safeOperationalHospital(hospitals: HospitalSystem, index: number, world: World, scenario: Scenario): boolean {
  const hospital = scenario.buildings.find((building) => building.id === hospitals.id[index]);
  return hospital !== undefined && hospitals.capacity[index] > hospitals.occupied[index] + hospitals.reserved[index] &&
    world.powered[hospital.entrance] > 0 && !hospital.cells.some((cell) => world.water[cell] > hospital.floorHeight);
}

function topZone(system: HotspotSystem): number {
  let best = -1;
  for (let zone = 0; zone < system.score.length; zone++) {
    if (system.score[zone] > 0 && (best < 0 || system.score[zone] > system.score[best])) best = zone;
  }
  return best;
}

/** Stage only idle, unassigned units; active rescue/transport assignments are untouched. */
export function stageIdleAmbulances(system: HotspotSystem, ambulances: AmbulanceSystem, hospitals: HospitalSystem, world: World, scenario: Scenario, blocked: Uint8Array, navVersion: number): void {
  const zone = topZone(system);
  if (zone < 0) return;
  const zoneX = zone % system.columns;
  const zoneZ = Math.floor(zone / system.columns);
  const minX = zoneX * REGION_SIZE;
  const minZ = zoneZ * REGION_SIZE;
  const maxX = Math.min(system.width, minX + REGION_SIZE);
  const maxZ = Math.min(system.height, minZ + REGION_SIZE);
  const targets: number[] = [];
  for (let z = minZ; z < maxZ; z++) for (let x = minX; x < maxX; x++) {
    const cell = z * system.width + x;
    if ((world.block[cell] === BlockType.Road || world.block[cell] === BlockType.Bridge) && canEnter(world, scenario, "car", cell, blocked)) targets.push(cell);
  }
  if (!targets.length) return;
  const grid = buildHazardGrid(world, scenario, "car", blocked);
  const field = buildFlowField(grid, targets);
  let selected: { hospitalIndex: number; accessCell: number; eta: number } | undefined;
  for (let hospitalIndex = 0; hospitalIndex < hospitals.count; hospitalIndex++) {
    if (!safeOperationalHospital(hospitals, hospitalIndex, world, scenario)) continue;
    for (const accessCell of accessRoads(world, scenario, hospitalIndex, hospitals, blocked)) {
      const eta = field.distance[accessCell];
      if (!Number.isFinite(eta)) continue;
      if (!selected || eta < selected.eta || eta === selected.eta &&
          (hospitals.id[hospitalIndex] < hospitals.id[selected.hospitalIndex] ||
           hospitals.id[hospitalIndex] === hospitals.id[selected.hospitalIndex] && accessCell < selected.accessCell)) {
        selected = { hospitalIndex, accessCell, eta };
      }
    }
  }
  if (!selected) return;
  for (let unit = 0; unit < ambulances.count; unit++) {
    if (!ambulances.available[unit] || ambulances.state[unit] !== VehicleState.Idle || ambulances.assignment[unit] >= 0) continue;
    if (ambulances.cell[unit] === selected.accessCell) continue;
    planAmbulanceRoute(ambulances, unit, selected.accessCell, world, scenario, blocked, navVersion);
  }
}
