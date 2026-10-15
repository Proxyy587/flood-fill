import { expect, it } from "vitest";
import type { RequestId, VehicleId } from "../../contracts/types";
import { enumerateCandidates } from "./policy-common";
import type { DispatchDemand, DispatchUnit } from "./policy-common";
import { runNegotiation } from "./negotiation";
import { runCentralised } from "./centralised";

const units: DispatchUnit[] = [
  { id: 10 as VehicleId, available: true },
  { id: 20 as VehicleId, available: true },
  { id: 30 as VehicleId, available: false },
];

function demand(id: number, uncoveredCasualties = 1, zoneScore = 0, severityEvidence = 0, createdTick = 0): DispatchDemand {
  return { id: id as RequestId, cell: id, createdTick, uncoveredCasualties, zoneScore, severityEvidence };
}

it("enumerates the same finite feasible candidate set without unavailable units", () => {
  const requests = [demand(1), demand(2)];
  const eta = Float64Array.from([4, 3, 1, 2, 5, 6]);
  expect(enumerateCandidates(requests, units, eta)).toEqual([
    { requestIndex: 0, unitIndex: 0, eta: 4 },
    { requestIndex: 0, unitIndex: 1, eta: 3 },
    { requestIndex: 1, unitIndex: 0, eta: 2 },
    { requestIndex: 1, unitIndex: 1, eta: 5 },
  ]);
});

it("centralized matching orders by uncovered casualties then zone, severity, age and request id", () => {
  const requests = [demand(5, 1, 0, 0), demand(4, 2, 0, 0), demand(3, 1, 9, 0), demand(2, 1, 9, 2, 5), demand(1, 1, 9, 2, 1)];
  const allUnits = [...units.slice(0, 2), { id: 40 as VehicleId, available: true }, { id: 50 as VehicleId, available: true }];
  const eta = new Float64Array(requests.length * allUnits.length).fill(2);
  const result = runCentralised(requests, allUnits, eta);

  expect(result.assignments.map((pair) => pair.requestId)).toEqual([4, 4, 1, 2]);
  expect(result.assignments.map((pair) => pair.vehicleId)).toEqual([10, 20, 40, 50]);
});

it("negotiation resolves contested incident bids by ETA then stable ambulance ID", () => {
  const requests = [demand(9)];
  const result = runNegotiation(requests, units, Float64Array.from([4, 2, 1]));

  expect(result.assignments).toHaveLength(1);
  expect(result.assignments[0]).toMatchObject({ requestId: 9, vehicleId: 20, eta: 2 });
  expect(result.bids).toMatchObject([
    { round: 0, requestId: 9, vehicleId: 10, eta: 4, accepted: false },
    { round: 0, requestId: 9, vehicleId: 20, eta: 2, accepted: true },
  ]);
});

it("assigns separate available ambulances up to discovered uncovered casualty demand", () => {
  const requests = [demand(7, 3)];
  const result = runNegotiation(requests, units, Float64Array.from([1, 2, 3]));

  expect(result.assignments.map((pair) => pair.vehicleId)).toEqual([10, 20]);
  expect(result.assignments.every((pair) => pair.requestId === 7)).toBe(true);
});

it("returns byte-stable policy output for the same candidates", () => {
  const requests = [demand(5, 1, 2), demand(7, 2, 1)];
  const eta = Float64Array.from([1, 2, 4, 2, 1, 3]);
  expect(runNegotiation(requests, units, eta)).toEqual(runNegotiation(requests, units, eta));
  expect(runCentralised(requests, units, eta)).toEqual(runCentralised(requests, units, eta));
});
