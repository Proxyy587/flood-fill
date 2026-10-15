import type { RequestId, VehicleId } from "../../contracts/types";

/** This policy input deliberately contains no report truth, civilian identity or health. */
export interface DispatchDemand {
  id: RequestId;
  cell: number;
  createdTick: number;
  uncoveredCasualties: number;
  zoneScore: number;
  severityEvidence: number;
}

export interface DispatchUnit {
  id: VehicleId;
  available: boolean;
}

export interface DispatchCandidate {
  requestIndex: number;
  unitIndex: number;
  eta: number;
}

export interface DispatchAssignment {
  requestIndex: number;
  unitIndex: number;
  requestId: RequestId;
  vehicleId: VehicleId;
  eta: number;
}

export interface DispatchBid extends DispatchAssignment {
  round: number;
  accepted: boolean;
}

export function enumerateCandidates(requests: readonly DispatchDemand[], units: readonly DispatchUnit[], etaSeconds: Float64Array): DispatchCandidate[] {
  if (etaSeconds.length !== requests.length * units.length) throw new RangeError("ETA matrix must have one entry per request/unit pair");
  const candidates: DispatchCandidate[] = [];
  for (let requestIndex = 0; requestIndex < requests.length; requestIndex++) {
    const request = requests[requestIndex];
    if (!Number.isSafeInteger(request.id) || request.id <= 0 || !Number.isSafeInteger(request.createdTick) || request.createdTick < 0 ||
        !Number.isSafeInteger(request.uncoveredCasualties) || request.uncoveredCasualties < 0 || !Number.isFinite(request.zoneScore) || request.zoneScore < 0 ||
        !Number.isFinite(request.severityEvidence) || request.severityEvidence < 0) throw new RangeError("Dispatch demand contains an invalid priority field");
    for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
      const eta = etaSeconds[requestIndex * units.length + unitIndex];
      if (Number.isNaN(eta) || eta < 0) throw new RangeError("Dispatch ETA must be nonnegative or Infinity when infeasible");
      if (units[unitIndex].available && Number.isFinite(eta)) candidates.push({ requestIndex, unitIndex, eta });
    }
  }
  return candidates;
}

export function compareDemand(a: DispatchDemand, b: DispatchDemand): number {
  return b.uncoveredCasualties - a.uncoveredCasualties || b.zoneScore - a.zoneScore || b.severityEvidence - a.severityEvidence ||
    a.createdTick - b.createdTick || a.id - b.id;
}

export function assignment(candidate: DispatchCandidate, requests: readonly DispatchDemand[], units: readonly DispatchUnit[]): DispatchAssignment {
  return {
    requestIndex: candidate.requestIndex,
    unitIndex: candidate.unitIndex,
    requestId: requests[candidate.requestIndex].id,
    vehicleId: units[candidate.unitIndex].id,
    eta: candidate.eta,
  };
}
