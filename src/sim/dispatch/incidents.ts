import type { RequestId, SimEvent } from "../../contracts/types";
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
