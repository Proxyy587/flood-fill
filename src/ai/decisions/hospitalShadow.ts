import type { Scenario } from '../../contracts/types';
import { listHospitalCandidates, triageHealth, type HospitalSystem } from '../../sim/dispatch/hospitals';
import type { World } from '../../sim/world/grid';
import type { LayaCandidate, LayaPrediction } from './layaClient';

export interface HospitalShadowCase {
  state: string;
  candidates: LayaCandidate[];
  deterministicChoice: string;
}

export function makeHospitalShadowCase(hospitals: HospitalSystem, health: number, fromCell: number,
  world: World, scenario: Scenario, blocked: Uint8Array): HospitalShadowCase | null {
  const feasible = listHospitalCandidates(hospitals, health, fromCell, world, scenario, blocked).slice(0, 5);
  if (!feasible.length) return null;
  const candidates = feasible.map((hospital) => {
    const freeBeds = hospitals.capacity[hospital.hospitalIndex] - hospitals.occupied[hospital.hospitalIndex] - hospitals.reserved[hospital.hospitalIndex];
    return {
      id: `h${hospital.hospitalId}`,
      description: `Hospital ${hospital.hospitalId}: ${hospital.eta} travel ticks, ${freeBeds} beds available, projected load score ${hospital.score.toFixed(2)}`,
    };
  });
  const state = JSON.stringify({
    setting: 'Synthetic flood rescue simulation',
    patientSeverity: triageHealth(health),
    patientHealth: health,
    feasibleHospitalCount: candidates.length,
    rule: 'Choose among the listed feasible hospitals only; this is an observational comparison.',
  });
  return { state, candidates, deterministicChoice: candidates[0].id };
}

export function compareHospitalShadow(shadow: HospitalShadowCase, prediction: LayaPrediction): {
  agreed: boolean;
  modelChoice: string;
  deterministicChoice: string;
  probability: number;
  durationMs: number;
} {
  if (!shadow.candidates.some((candidate) => candidate.id === prediction.choice)) {
    throw new Error('Laya chose a candidate outside the feasible shortlist');
  }
  return {
    agreed: prediction.choice === shadow.deterministicChoice,
    modelChoice: prediction.choice,
    deterministicChoice: shadow.deterministicChoice,
    probability: prediction.probabilities[prediction.choice],
    durationMs: prediction.durationMs,
  };
}
