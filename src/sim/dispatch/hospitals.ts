import { BlockType, NpcState } from "../../contracts/types";
import type { BuildingId, Scenario } from "../../contracts/types";
import type { PopulationState } from "../agents/population";
import { buildHazardGrid, canEnter } from "../nav/hazards";
import { findPath } from "../nav";
import type { World } from "../world/grid";

export type InjurySeverity = "minor" | "moderate" | "severe";
const exposureThreshold = Math.fround(0.3);

/** Synthetic exposure only; the caller marks patients loaded after field triage. */
export function stepExposure(population: PopulationState, world: World, loaded: Uint8Array): void {
  const civilians = population.civilianCount;
  if (loaded.length !== civilians) throw new RangeError("Loaded-patient flags must match the civilian table");
  for (let npc = 0; npc < civilians; npc++) {
    if (loaded[npc]) continue;
    const state = population.npcs.state[npc];
    if (state !== NpcState.SeekHelp && state !== NpcState.Stranded) continue;
    const depth = world.water[population.npcs.cell[npc]];
    if (depth <= exposureThreshold) continue;
    population.npcs.health[npc] = Math.max(0, population.npcs.health[npc] - (0.25 + 0.5 * (depth - 0.3)));
  }
}

/** Abstract simulation tier, not a clinical severity assessment. */
export function triageHealth(health: number): InjurySeverity {
  if (!Number.isFinite(health) || health < 0 || health > 100) throw new RangeError("Synthetic health must be finite and in [0,100]");
  if (health > 75) return "minor";
  if (health > 50) return "moderate";
  return "severe";
}

export interface HospitalSystem {
  count: number;
  patientCapacity: number;
  id: Int32Array;
  capacity: Int32Array;
  occupied: Int32Array;
  reserved: Int32Array;
  patientReservation: Int32Array;
  patientAdmitted: Uint8Array;
  patientAdmittedTick: Int32Array;
}

export interface HospitalDestination {
  hospitalIndex: number;
  hospitalId: BuildingId;
  accessCell: number;
  route: Int32Array;
  eta: number;
  score: number;
}

export function createHospitalSystem(scenario: Scenario, patientCapacity: number): HospitalSystem {
  if (!Number.isSafeInteger(patientCapacity) || patientCapacity < 0) throw new RangeError("Patient capacity must be a nonnegative integer");
  const hospitals = scenario.buildings.filter((building) => building.type === BlockType.Hospital).sort((a, b) => a.id - b.id);
  return {
    count: hospitals.length,
    patientCapacity,
    id: Int32Array.from(hospitals, (building) => building.id),
    capacity: Int32Array.from(hospitals, (building) => building.capacity),
    occupied: new Int32Array(hospitals.length),
    reserved: new Int32Array(hospitals.length),
    patientReservation: new Int32Array(patientCapacity).fill(-1),
    patientAdmitted: new Uint8Array(patientCapacity),
    patientAdmittedTick: new Int32Array(patientCapacity).fill(-1),
  };
}

function hospitalIsOperational(system: HospitalSystem, hospitalIndex: number, world: World, scenario: Scenario): boolean {
  const hospital = scenario.buildings.find((building) => building.id === system.id[hospitalIndex]);
  return hospital !== undefined && system.capacity[hospitalIndex] > 0 && world.powered[hospital.entrance] > 0 &&
    !hospital.cells.some((cell) => world.water[cell] > hospital.floorHeight);
}

function hospitalAccessCells(world: World, scenario: Scenario, hospitalIndex: number, system: HospitalSystem, blocked: Uint8Array): number[] {
  const hospital = scenario.buildings.find((building) => building.id === system.id[hospitalIndex]);
  if (!hospital) return [];
  const entrance = hospital.entrance;
  const x = entrance % world.width;
  const z = Math.floor(entrance / world.width);
  const adjacent: number[] = [];
  if (z > 0) adjacent.push(entrance - world.width);
  if (x + 1 < world.width) adjacent.push(entrance + 1);
  if (z + 1 < world.height) adjacent.push(entrance + world.width);
  if (x > 0) adjacent.push(entrance - 1);
  return adjacent.filter((cell) => (world.block[cell] === BlockType.Road || world.block[cell] === BlockType.Bridge) && canEnter(world, scenario, "car", cell, blocked)).sort((a, b) => a - b);
}

function routeToHospital(system: HospitalSystem, hospitalIndex: number, fromCell: number, world: World, scenario: Scenario, blocked: Uint8Array): HospitalDestination | undefined {
  if (!hospitalIsOperational(system, hospitalIndex, world, scenario)) return undefined;
  const grid = buildHazardGrid(world, scenario, "car", blocked);
  let best: HospitalDestination | undefined;
  for (const accessCell of hospitalAccessCells(world, scenario, hospitalIndex, system, blocked)) {
    const path = findPath(grid, fromCell, accessCell);
    if (!path) continue;
    const eta = Math.max(0, path.length - 1);
    if (!best || eta < best.eta || eta === best.eta && accessCell < best.accessCell) {
      best = { hospitalIndex, hospitalId: system.id[hospitalIndex] as BuildingId, accessCell, route: Int32Array.from(path), eta, score: eta };
    }
  }
  return best;
}

export function releaseHospitalReservation(system: HospitalSystem, patient: number): boolean {
  if (!Number.isInteger(patient) || patient < 0 || patient >= system.patientCapacity) throw new RangeError("Patient index is outside the hospital reservation table");
  const hospital = system.patientReservation[patient];
  if (hospital < 0) return false;
  system.reserved[hospital]--;
  system.patientReservation[patient] = -1;
  return true;
}

/** Pure shortlist used by deterministic selection and observational decision policies. */
export function listHospitalCandidates(system: HospitalSystem, health: number, fromCell: number, world: World, scenario: Scenario, blocked: Uint8Array): HospitalDestination[] {
  const severity = triageHealth(health);
  const severityScore = severity === "severe" ? 1 : severity === "minor" ? 0 : Math.min(1, Math.max(0, (75 - health) / 25));
  const candidates: HospitalDestination[] = [];
  for (let hospitalIndex = 0; hospitalIndex < system.count; hospitalIndex++) {
    if (system.occupied[hospitalIndex] + system.reserved[hospitalIndex] >= system.capacity[hospitalIndex]) continue;
    const destination = routeToHospital(system, hospitalIndex, fromCell, world, scenario, blocked);
    if (!destination) continue;
    const projectedUtilization = (system.occupied[hospitalIndex] + system.reserved[hospitalIndex] + 1) / system.capacity[hospitalIndex];
    destination.score = severity === "severe" ? destination.eta : destination.eta + 60 * (1 - severityScore) * projectedUtilization;
    candidates.push(destination);
  }
  return candidates.sort((a, b) => a.score - b.score || a.hospitalId - b.hospitalId || a.accessCell - b.accessCell);
}

export function reserveHospitalBed(system: HospitalSystem, patient: number, health: number, fromCell: number, world: World, scenario: Scenario, blocked: Uint8Array, preferredHospitalId?: number): HospitalDestination | undefined {
  if (!Number.isInteger(patient) || patient < 0 || patient >= system.patientCapacity) throw new RangeError("Patient index is outside the hospital reservation table");
  if (system.patientAdmitted[patient]) return undefined;
  const current = system.patientReservation[patient];
  if (current >= 0) {
    const existing = routeToHospital(system, current, fromCell, world, scenario, blocked);
    if (existing) return existing;
    releaseHospitalReservation(system, patient);
  }
  const candidates = listHospitalCandidates(system, health, fromCell, world, scenario, blocked);
  const selected = candidates.find((candidate) => candidate.hospitalId === preferredHospitalId) ?? candidates[0];
  if (!selected) return undefined;
  system.reserved[selected.hospitalIndex]++;
  system.patientReservation[patient] = selected.hospitalIndex;
  return selected;
}

export function admitPatientToHospital(system: HospitalSystem, patient: number, tick = 0): boolean {
  if (!Number.isInteger(patient) || patient < 0 || patient >= system.patientCapacity) throw new RangeError("Patient index is outside the hospital reservation table");
  const hospital = system.patientReservation[patient];
  if (hospital < 0 || system.patientAdmitted[patient]) return false;
  system.reserved[hospital]--;
  system.occupied[hospital]++;
  system.patientReservation[patient] = -1;
  system.patientAdmitted[patient] = 1;
  system.patientAdmittedTick[patient] = tick;
  return true;
}
