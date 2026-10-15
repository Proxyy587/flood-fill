import { assignment, compareDemand, enumerateCandidates } from "./policy-common";
import type { DispatchAssignment, DispatchBid, DispatchDemand, DispatchUnit } from "./policy-common";

/** Unit-led proposals; each demand accepts its best bids up to uncovered patient count. */
export function runNegotiation(requests: readonly DispatchDemand[], units: readonly DispatchUnit[], etaSeconds: Float64Array): { assignments: DispatchAssignment[]; bids: DispatchBid[] } {
  const candidates = enumerateCandidates(requests, units, etaSeconds);
  const requestOrder = Array.from({ length: requests.length }, (_, index) => index).sort((a, b) => compareDemand(requests[a], requests[b]));
  const candidateByPair = new Map<number, typeof candidates[number]>();
  for (const candidate of candidates) candidateByPair.set(candidate.requestIndex * units.length + candidate.unitIndex, candidate);
  const remaining = Int32Array.from(requests, (request) => request.uncoveredCasualties);
  const free = Uint8Array.from(units, (unit) => Number(unit.available));
  const assignments: DispatchAssignment[] = [];
  const bids: DispatchBid[] = [];
  let round = 0;

  while (true) {
    const proposals: { requestIndex: number; unitIndex: number; eta: number }[] = [];
    for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
      if (!free[unitIndex]) continue;
      let selected: { requestIndex: number; unitIndex: number; eta: number } | undefined;
      for (const requestIndex of requestOrder) {
        if (remaining[requestIndex] <= 0) continue;
        const candidate = candidateByPair.get(requestIndex * units.length + unitIndex);
        if (!candidate) continue;
        if (!selected || compareDemand(requests[requestIndex], requests[selected.requestIndex]) < 0 ||
            compareDemand(requests[requestIndex], requests[selected.requestIndex]) === 0 &&
            (candidate.eta < selected.eta || candidate.eta === selected.eta && requests[requestIndex].id < requests[selected.requestIndex].id)) {
          selected = candidate;
        }
      }
      if (selected) proposals.push(selected);
    }
    if (!proposals.length) break;

    const accepted = new Uint8Array(proposals.length);
    for (const requestIndex of requestOrder) {
      const incoming = proposals.map((proposal, index) => ({ proposal, index }))
        .filter(({ proposal }) => proposal.requestIndex === requestIndex)
        .sort((a, b) => a.proposal.eta - b.proposal.eta || units[a.proposal.unitIndex].id - units[b.proposal.unitIndex].id);
      for (const { proposal, index } of incoming) {
        if (remaining[requestIndex] <= 0) break;
        accepted[index] = 1;
        remaining[requestIndex]--;
        free[proposal.unitIndex] = 0;
        const pair = assignment(proposal, requests, units);
        assignments.push(pair);
      }
    }
    for (let index = 0; index < proposals.length; index++) {
      const pair = assignment(proposals[index], requests, units);
      bids.push({ ...pair, round, accepted: accepted[index] === 1 });
    }
    if (accepted.every((value) => value === 0)) break;
    round++;
  }
  return { assignments, bids };
}
