import { BlockType, type LayaDecisionTape, type Scenario } from '../../contracts';
import type { LayaClient, LayaPrediction } from './layaClient';

export const LAYA_MODEL_REVISION = '55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851';

/** Hash the actual editable scenario so edits or a changed seed invalidate a prepared tape. */
export function scenarioFingerprint(scenario: Scenario): string {
  const source = JSON.stringify(scenario);
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function applicableLayaTape(scenario: Scenario, seed: number, tape: LayaDecisionTape | null | undefined): LayaDecisionTape | undefined {
  return tape?.seed === seed && tape.scenarioFingerprint === scenarioFingerprint(scenario) ? tape : undefined;
}

export interface PreparedLayaRun {
  tape: LayaDecisionTape;
  predictions: Record<string, LayaPrediction>;
}

export async function prepareLayaRun(scenario: Scenario, client: Pick<LayaClient, 'choose'>): Promise<PreparedLayaRun> {
  const fingerprint = scenarioFingerprint(scenario);
  const seed = scenario.defaults.seed;
  const hospitals = scenario.buildings.filter((building) => building.type === BlockType.Hospital && building.capacity > 0)
    .sort((a, b) => a.id - b.id).slice(0, 5);
  const state = JSON.stringify({ setting: 'Synthetic flood rescue simulation', flood: scenario.weather.floodKind,
    population: scenario.population.count, ambulances: scenario.fleet.ambulances, boats: scenario.fleet.boats,
    hospitals: hospitals.map((hospital) => ({ id: hospital.id, beds: hospital.capacity })),
    rule: 'Run-start policy only. The simulator enforces current power, flood, route and bed safety at assignment time.' });
  const predictions: Record<string, LayaPrediction> = {};
  predictions.dispatch = await client.choose(state, [
    { id: 'negotiation', description: 'Ambulance units bid independently on rescue requests' },
    { id: 'centralised', description: 'Central dispatcher assigns ambulance units to rescue requests' },
  ], 'Choose the dispatch policy for this synthetic flood simulation.');
  if (predictions.dispatch.choice !== 'negotiation' && predictions.dispatch.choice !== 'centralised') throw new Error('Invalid Laya dispatch choice');
  const hospitalPreference: LayaDecisionTape['hospitalPreference'] = {};
  for (const tier of ['minor', 'moderate', 'severe'] as const) {
    if (!hospitals.length) break;
    predictions[tier] = await client.choose(state, hospitals.map((hospital) => ({ id: `h${hospital.id}`,
      description: `Hospital ${hospital.id}: ${hospital.capacity} total beds. Current availability is checked by the simulator.` })),
    `Choose a run-start preferred hospital for ${tier} synthetic casualties. Safety and capacity are checked at dispatch time.`);
    const choice = Number(predictions[tier].choice.slice(1));
    if (!hospitals.some((hospital) => hospital.id === choice)) throw new Error('Invalid Laya hospital choice');
    hospitalPreference[tier] = choice;
  }
  return { tape: { version: 1, modelRevision: LAYA_MODEL_REVISION, scenarioFingerprint: fingerprint, seed,
    dispatchMode: predictions.dispatch.choice, hospitalPreference }, predictions };
}
