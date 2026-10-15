import { NpcState, ReportStatus } from "../../contracts/types";
import type { PopulationState } from "../agents/population";
import type { NpcId, RequestId, SimEvent } from "../../contracts/types";
import { triageHealth } from "./hospitals";
import type { HospitalSystem } from "./hospitals";
import type { ReportSystem } from "../reports/system";

export interface IncidentSystem {
  capacity: number;
  count: number;
  requestId: Int32Array;
  estimatedCell: Int32Array;
  confidence: Float32Array;
  createdTick: Int32Array;
  active: Uint8Array;
  reportCount: Int32Array;
  reportStart: Int32Array;
  reportIndices: Int32Array;
  reportIncident: Int32Array;
  patientCapacity: number;
  casualtyCount: Int32Array;
  discovered: Uint8Array;
  patientCount: number;
  patientNpc: Int32Array;
  patientCell: Int32Array;
  patientIncident: Int32Array;
  patientIncidentByNpc: Int32Array;
  patientAssignedUnit: Int32Array;
  patientLoaded: Uint8Array;
  patientHealth: Float32Array;
  patientSeverity: Uint8Array;
}

export function createIncidentSystem(reports: ReportSystem): IncidentSystem {
  const capacity = reports.id.length;
  return {
    capacity,
    count: 0,
    requestId: new Int32Array(capacity),
    estimatedCell: new Int32Array(capacity),
    confidence: new Float32Array(capacity),
    createdTick: new Int32Array(capacity),
    active: new Uint8Array(capacity),
    reportCount: new Int32Array(capacity),
    reportStart: new Int32Array(capacity),
    reportIndices: new Int32Array(capacity),
    reportIncident: new Int32Array(capacity).fill(-1),
    patientCapacity: reports.inDistress.length,
    casualtyCount: new Int32Array(capacity),
    discovered: new Uint8Array(capacity),
    patientCount: 0,
    patientNpc: new Int32Array(reports.inDistress.length).fill(-1),
    patientCell: new Int32Array(reports.inDistress.length).fill(-1),
    patientIncident: new Int32Array(reports.inDistress.length).fill(-1),
    patientIncidentByNpc: new Int32Array(reports.inDistress.length).fill(-1),
    patientAssignedUnit: new Int32Array(reports.inDistress.length).fill(-1),
    patientLoaded: new Uint8Array(reports.inDistress.length),
    patientHealth: new Float32Array(reports.inDistress.length),
    patientSeverity: new Uint8Array(reports.inDistress.length),
  };
}

function clusterRoot(reports: ReportSystem, report: number): number {
  let root = report;
  let remaining = reports.count;
  while (reports.clusterParent[root] !== root && remaining > 0) {
    root = reports.clusterParent[root];
    remaining--;
  }
  if (remaining === 0) throw new Error("Report cluster parent contains a cycle");
  return root;
}

/** Build one active incident per delivered M3A report cluster without exposing truth fields. */
export function updateIncidents(system: IncidentSystem, reports: ReportSystem, tick: number): SimEvent[] {
  const slotForRoot = new Int32Array(system.capacity).fill(-1);

  // Reconnect previously-created incidents first. M3A can merge cluster roots when
  // a newly delivered report bridges two recent clusters.
  for (let report = 0; report < reports.count; report++) {
    if (!reports.delivered[report] || system.reportIncident[report] < 0) continue;
    const root = clusterRoot(reports, report);
    const priorSlot = system.reportIncident[report];
    if (slotForRoot[root] < 0 || system.requestId[priorSlot] < system.requestId[slotForRoot[root]]) slotForRoot[root] = priorSlot;
  }

  const events: SimEvent[] = [];
  const selectedSlots = new Uint8Array(system.capacity);
  for (let report = 0; report < reports.count; report++) {
    if (!reports.delivered[report]) continue;
    const root = clusterRoot(reports, report);
    let slot = slotForRoot[root];
    if (slot < 0) {
      if (system.count >= system.capacity) throw new Error("Incident count exceeded its preallocated report bound");
      slot = system.count++;
      system.requestId[slot] = reports.id[report];
      system.estimatedCell[slot] = reports.estimatedCell[report];
      system.confidence[slot] = reports.confidence[report];
      system.createdTick[slot] = reports.createdTick[report];
      system.active[slot] = 1;
      slotForRoot[root] = slot;
      events.push({ tick, type: "REQUEST_CREATED", target: reports.id[report] as RequestId, targetKind: "request", cell: reports.estimatedCell[report],
        data: { reportId: reports.id[report], confidence: reports.confidence[report] }, reason: "Provisional response request created from a delivered report cluster" });
    }
    system.reportIncident[report] = slot;
    selectedSlots[slot] = 1;
    if (reports.id[report] < system.requestId[slot]) system.requestId[slot] = reports.id[report];
    if (reports.confidence[report] > system.confidence[slot]) system.confidence[slot] = reports.confidence[report];
    if (reports.createdTick[report] < system.createdTick[slot]) {
      system.createdTick[slot] = reports.createdTick[report];
      system.estimatedCell[slot] = reports.estimatedCell[report];
    }
  }

  system.reportCount.fill(0);
  for (let report = 0; report < reports.count; report++) {
    if (!reports.delivered[report]) continue;
    const slot = system.reportIncident[report];
    if (slot >= 0) system.reportCount[slot]++;
  }
  let offset = 0;
  for (let slot = 0; slot < system.count; slot++) {
    system.reportStart[slot] = offset;
    offset += system.reportCount[slot];
  }
  const cursor = system.reportStart.slice(0, system.count);
  for (let report = 0; report < reports.count; report++) {
    if (!reports.delivered[report]) continue;
    const slot = system.reportIncident[report];
    if (slot >= 0) system.reportIndices[cursor[slot]++] = report;
  }
  for (let slot = 0; slot < system.count; slot++) if (system.active[slot] && !selectedSlots[slot]) system.active[slot] = 0;
  return events;
}

export function incidentSnapshot(system: IncidentSystem): {
  requestId: Int32Array; estimatedCell: Int32Array; confidence: Float32Array; createdTick: Int32Array; active: Uint8Array;
} {
  const length = system.count;
  return {
    requestId: system.requestId.slice(0, length),
    estimatedCell: system.estimatedCell.slice(0, length),
    confidence: system.confidence.slice(0, length),
    createdTick: system.createdTick.slice(0, length),
    active: system.active.slice(0, length),
  };
}

/** Called only when an ambulance reaches the incident; no report truth is read. */
export function discoverIncidentAtScene(system: IncidentSystem, reports: ReportSystem, population: PopulationState, incident: number, tick: number): SimEvent[] {
  if (!Number.isInteger(incident) || incident < 0 || incident >= system.count) throw new RangeError("Incident index is outside the incident table");
  if (system.discovered[incident]) return [];
  system.discovered[incident] = 1;
  const events: SimEvent[] = [];
  const reportStart = system.reportStart[incident];
  const reportEnd = reportStart + system.reportCount[incident];
  const width = reports.width;
  for (let position = reportStart; position < reportEnd; position++) {
    const report = system.reportIndices[position];
    const estimate = reports.estimatedCell[report];
    const estimateX = estimate % width;
    const estimateZ = Math.floor(estimate / width);
    const radius = Math.ceil((1 - reports.confidence[report]) * 4);
    let foundDistress = false;
    for (let npc = 0; npc < population.civilianCount; npc++) {
      const state = population.npcs.state[npc];
      if (state !== NpcState.SeekHelp && state !== NpcState.Stranded) continue;
      const cell = population.npcs.cell[npc];
      const distance = Math.abs(cell % width - estimateX) + Math.abs(Math.floor(cell / width) - estimateZ);
      if (distance > radius) continue;
      foundDistress = true;
      if (system.patientIncidentByNpc[npc] >= 0) continue;
      if (system.patientCount >= system.patientCapacity) throw new Error("Discovered casualty count exceeded its civilian bound");
      const patient = system.patientCount++;
      system.patientNpc[patient] = npc;
      system.patientCell[patient] = cell;
      system.patientIncident[patient] = incident;
      system.patientIncidentByNpc[npc] = patient;
      system.patientHealth[patient] = population.npcs.health[npc];
      const severity = triageHealth(population.npcs.health[npc]);
      system.patientSeverity[patient] = severity === "minor" ? 0 : severity === "moderate" ? 1 : 2;
      system.casualtyCount[incident]++;
    }
    reports.status[report] = foundDistress ? ReportStatus.Verified : ReportStatus.False;
    events.push({ tick, type: foundDistress ? "REPORT_VERIFIED" : "REPORT_FALSE", cell: estimate,
      data: { reportId: reports.id[report], requestId: system.requestId[incident] },
      reason: foundDistress ? "Ambulance field search found distress within the report uncertainty footprint" : "Ambulance field search found no distress within the report uncertainty footprint" });
  }
  if (system.casualtyCount[incident] === 0) system.active[incident] = 0;
  return events;
}

/** Resolve reports and incident only after every discovered casualty has a bed admission. */
export function completeAdmittedIncidents(system: IncidentSystem, reports: ReportSystem, hospitals: HospitalSystem, tick: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let incident = 0; incident < system.count; incident++) {
    if (!system.discovered[incident] || system.casualtyCount[incident] === 0 || !system.active[incident]) continue;
    let admitted = 0;
    for (let patient = 0; patient < system.patientCount; patient++) {
      if (system.patientIncident[patient] === incident && hospitals.patientAdmitted[patient]) admitted++;
    }
    if (admitted !== system.casualtyCount[incident]) continue;
    system.active[incident] = 0;
    for (let patient = 0; patient < system.patientCount; patient++) {
      if (system.patientIncident[patient] !== incident) continue;
      events.push({ tick, type: "SERVED", actor: (system.patientNpc[patient] + 1) as NpcId, actorKind: "npc",
        target: system.requestId[incident] as RequestId, targetKind: "request",
        data: { reportToBedTicks: Math.max(0, tick - system.createdTick[incident]) }, reason: "Field-confirmed casualty admitted to a reserved operational hospital bed" });
    }
    for (let report = 0; report < reports.count; report++) {
      if (system.reportIncident[report] === incident && reports.status[report] === ReportStatus.Verified) reports.status[report] = ReportStatus.Resolved;
    }
  }
  return events;
}
