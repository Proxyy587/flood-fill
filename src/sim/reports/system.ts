import { NpcState, ReportStatus } from "../../contracts/types";
import type { RenderSnapshot, SimEvent } from "../../contracts/types";
import { createRng } from "../rng";
import type { PopulationState } from "../agents/population";

export interface ReportSystem {
  width: number; height: number; count: number; id: Int32Array; estimatedCell: Int32Array; trueCell: Int32Array;
  sourceNpc: Int32Array; confidence: Float32Array; status: Uint8Array; createdTick: Int32Array; deliveryTick: Int32Array;
  delivered: Uint8Array; isFalse: Uint8Array; inDistress: Uint8Array; distressReported: Uint8Array;
  falseDrawn: Uint8Array; rng: ReturnType<typeof createRng>; falseAlarmRng: ReturnType<typeof createRng>; belief: Float32Array;
  cellHead: Int32Array; nextInCell: Int32Array; clusterParent: Int32Array; clusterConfidence: Float32Array;
}

export function createReportSystem(population: PopulationState, width: number, height: number, seed: number, scheduledFalseReports = 0): ReportSystem {
  const capacity = population.civilianCount * 2 + scheduledFalseReports;
  return { width, height, count: 0, id: new Int32Array(capacity), estimatedCell: new Int32Array(capacity), trueCell: new Int32Array(capacity),
    sourceNpc: new Int32Array(capacity), confidence: new Float32Array(capacity), status: new Uint8Array(capacity),
    createdTick: new Int32Array(capacity), deliveryTick: new Int32Array(capacity), delivered: new Uint8Array(capacity),
    isFalse: new Uint8Array(capacity), inDistress: new Uint8Array(population.civilianCount), distressReported: new Uint8Array(population.civilianCount),
    falseDrawn: new Uint8Array(population.civilianCount), rng: createRng((seed ^ 0x9e3779b9) >>> 0),
    falseAlarmRng: createRng((seed ^ 0x85ebca6b) >>> 0), belief: new Float32Array(width * height),
    cellHead: new Int32Array(width * height).fill(-1), nextInCell: new Int32Array(capacity).fill(-1),
    clusterParent: new Int32Array(capacity), clusterConfidence: new Float32Array(capacity) };
}

function addReport(reports: ReportSystem, cell: number, truthCell: number, confidence: number, tick: number, deliveryTick: number, sourceNpc = -1, isFalse = true): number {
  if (reports.count >= reports.id.length) throw new Error("Report count exceeded its preallocated bound");
  const index = reports.count++;
  reports.id[index] = index + 1; reports.estimatedCell[index] = cell; reports.trueCell[index] = truthCell;
  reports.sourceNpc[index] = sourceNpc; reports.confidence[index] = confidence; reports.status[index] = ReportStatus.Unverified;
  reports.createdTick[index] = tick; reports.deliveryTick[index] = deliveryTick; reports.isFalse[index] = Number(isFalse);
  return index;
}

export function injectFalseReport(reports: ReportSystem, cell: number, confidence: number, tick: number, delay = 0): void {
  if (!Number.isInteger(cell) || cell < 0 || cell >= reports.width * reports.height || confidence < 0 || confidence > 1 || delay < 0) throw new RangeError("Invalid synthetic report injection");
  addReport(reports, cell, cell, confidence, tick, tick + delay);
}

export function reportSnapshot(reports: ReportSystem): RenderSnapshot["reports"] {
  const indices: number[] = [];
  for (let i = 0; i < reports.count; i++) if (reports.delivered[i]) indices.push(i);
  const x = new Float32Array(indices.length); const z = new Float32Array(indices.length);
  const confidence = new Float32Array(indices.length); const status = new Uint8Array(indices.length);
  indices.forEach((index, out) => { x[out] = reports.estimatedCell[index] % reports.width; z[out] = Math.floor(reports.estimatedCell[index] / reports.width); confidence[out] = reports.confidence[index]; status[out] = reports.status[index]; });
  return { x, z, confidence, status };
}

function findCluster(reports: ReportSystem, index: number): number {
  let root = index;
  while (reports.clusterParent[root] !== root) root = reports.clusterParent[root];
  while (reports.clusterParent[index] !== index) { const parent = reports.clusterParent[index]; reports.clusterParent[index] = root; index = parent; }
  return root;
}

function updateBelief(reports: ReportSystem, deliveredNow: number[], tick: number): void {
  for (const index of deliveredNow) {
    const cell = reports.estimatedCell[index]; const x = cell % reports.width; const z = Math.floor(cell / reports.width);
    let root = index; let weight = reports.confidence[index]; const matchedRoots: number[] = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (Math.abs(dx) + Math.abs(dz) > 1) continue;
      const nx = x + dx; const nz = z + dz;
      if (nx < 0 || nx >= reports.width || nz < 0 || nz >= reports.height) continue;
      for (let other = reports.cellHead[nz * reports.width + nx]; other >= 0; other = reports.nextInCell[other]) {
        if (tick - reports.createdTick[other] > 30) continue;
        const otherRoot = findCluster(reports, other);
        matchedRoots.push(otherRoot);
        weight = Math.max(weight, reports.clusterConfidence[otherRoot]);
        if (otherRoot < root) root = otherRoot;
      }
    }
    reports.clusterParent[index] = root; reports.clusterConfidence[index] = weight;
    for (const matchedRoot of matchedRoots) reports.clusterParent[matchedRoot] = root;
    reports.clusterConfidence[root] = weight;
    reports.nextInCell[index] = reports.cellHead[cell]; reports.cellHead[cell] = index;
  }
  reports.belief.fill(0);
  for (let i = 0; i < reports.count; i++) if (reports.delivered[i] && findCluster(reports, i) === i) {
    const cell = reports.estimatedCell[i]; reports.belief[cell] = Math.max(reports.belief[cell], reports.clusterConfidence[i]);
  }
}

export function stepReports(reports: ReportSystem, population: PopulationState, tick: number, outage = false): SimEvent[] {
  for (let i = 0; i < population.civilianCount; i++) {
    if (!reports.falseDrawn[i]) {
      reports.falseDrawn[i] = 1;
      if (reports.falseAlarmRng.next() < population.params.falseReportRate) {
        const cell = Math.floor(reports.falseAlarmRng.next() * reports.width * reports.height);
        addReport(reports, cell, cell, 0.25, tick, tick + population.params.commsDelay, -1, true);
      }
    }
  }
  for (let i = 0; i < population.civilianCount; i++) {
    const distressed = population.npcs.state[i] === NpcState.SeekHelp || population.npcs.state[i] === NpcState.Stranded;
    if (!distressed) { reports.inDistress[i] = 0; continue; }
    if (reports.inDistress[i]) continue;
    reports.inDistress[i] = 1;
    if (reports.distressReported[i] || reports.rng.next() >= population.npcs.awareness[i]) continue;
    const trueCell = population.npcs.cell[i]; const awareness = population.npcs.awareness[i]; const radius = Math.ceil((1 - awareness) * 4);
    const distance = Math.floor(reports.rng.next() * (radius + 1)); const direction = Math.floor(reports.rng.next() * 4);
    const dx = direction === 0 ? distance : direction === 1 ? -distance : 0; const dz = direction === 2 ? distance : direction === 3 ? -distance : 0;
    const x = Math.min(reports.width - 1, Math.max(0, trueCell % reports.width + dx));
    const z = Math.min(reports.height - 1, Math.max(0, Math.floor(trueCell / reports.width) + dz));
    const index = addReport(reports, z * reports.width + x, trueCell, awareness, tick, tick + population.params.commsDelay, population.npcs.id[i], false);
    reports.distressReported[i] = 1;
    reports.id[index] = index + 1;
  }
  const events: SimEvent[] = []; const deliveredNow: number[] = [];
  if (!outage) for (let i = 0; i < reports.count; i++) {
    if (reports.delivered[i] || reports.deliveryTick[i] > tick) continue;
    reports.delivered[i] = 1;
    deliveredNow.push(i);
    events.push({ tick, type: "REPORT_CREATED", cell: reports.estimatedCell[i],
      data: { reportId: reports.id[i], confidence: reports.confidence[i], createdTick: reports.createdTick[i] },
      reason: "Unverified distress report delivered with an uncertain location" });
  }
  updateBelief(reports, deliveredNow, tick);
  return events;
}
