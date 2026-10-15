import { assignment, compareDemand, enumerateCandidates } from "./policy-common";
import type { DispatchAssignment, DispatchDemand, DispatchUnit } from "./policy-common";

/** Greedy central baseline: rank demand, then choose its fastest feasible free unit. */
export function runCentralised(requests: readonly DispatchDemand[], units: readonly DispatchUnit[], etaSeconds: Float64Array): { assignments: DispatchAssignment[] } {
  const candidates = enumerateCandidates(requests, units, etaSeconds);
  const requestOrder = Array.from({ length: requests.length }, (_, index) => index).sort((a, b) => compareDemand(requests[a], requests[b]));
  const remaining = Int32Array.from(requests, (request) => request.uncoveredCasualties);
  const usedUnits = new Uint8Array(units.length);
  const assignments: DispatchAssignment[] = [];
  for (const requestIndex of requestOrder) {
    const feasible = candidates.filter((candidate) => candidate.requestIndex === requestIndex)
      .sort((a, b) => a.eta - b.eta || units[a.unitIndex].id - units[b.unitIndex].id);
    for (const candidate of feasible) {
      if (remaining[requestIndex] === 0) break;
      if (usedUnits[candidate.unitIndex]) continue;
      usedUnits[candidate.unitIndex] = 1;
      remaining[requestIndex]--;
      assignments.push(assignment(candidate, requests, units));
    }
  }
  return { assignments };
}
