import { expect, it } from 'vitest';
import { evaluateLayaDecision, localLayaModelUrl } from './layaWorkerCore';

it('uses a same-origin absolute model URL for the browser runtime', () => {
  expect(localLayaModelUrl('http://localhost:3005/laya')).toBe('http://localhost:3005/models/laya');
});

const candidates = [
  { id: 'h2', description: 'Hospital 2: 4 ticks, 3 free beds' },
  { id: 'h5', description: 'Hospital 5: 6 ticks, 8 free beds' },
];

it('sends bounded hospital choices to Laya and returns a typed result', async () => {
  const seen: unknown[] = [];
  const result = await evaluateLayaDecision(async (state, questions) => {
    seen.push({ state, questions });
    return { answers: { hospital: { type: 'choice', choice: 'h5', probabilities: { h2: 0.1, h5: 0.9 } } }, usage: { truncated: false } };
  }, 'Synthetic severe patient', candidates);
  expect(seen).toEqual([{ state: 'Synthetic severe patient', questions: {
    hospital: { type: 'choice', instructions: 'Which feasible hospital should receive this simulated patient?', criteria: {
      h2: 'Hospital 2: 4 ticks, 3 free beds', h5: 'Hospital 5: 6 ticks, 8 free beds',
    } },
  } }]);
  expect(result).toEqual({ choice: 'h5', probabilities: { h2: 0.1, h5: 0.9 } });
});

it('rejects a truncated model observation', async () => {
  await expect(evaluateLayaDecision(async () => ({ answers: { hospital: { type: 'choice', choice: 'h2', probabilities: { h2: 1 } } },
    usage: { truncated: true } }), 'state', candidates)).rejects.toThrow(/truncated/i);
});
