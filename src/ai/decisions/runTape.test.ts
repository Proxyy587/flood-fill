import { expect, it } from 'vitest';
import { mockScenario } from '../../contracts/mocks/scenario';
import { applicableLayaTape, prepareLayaRun } from './runTape';

it('prepares bounded model decisions and invalidates them after scenario edits', async () => {
  const scenario = mockScenario();
  const asked: string[] = [];
  const client = { choose: async (_state: string, candidates: readonly { id: string; description: string }[], instructions?: string) => {
    asked.push(instructions ?? '');
    const choice = candidates[0].id;
    return { choice, probabilities: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.id === choice ? 1 : 0])), durationMs: 1 };
  } };
  const { tape } = await prepareLayaRun(scenario, client);
  expect(tape.dispatchMode).toBe('negotiation');
  expect(asked).toHaveLength(4);
  expect(applicableLayaTape(scenario, scenario.defaults.seed, tape)).toEqual(tape);
  scenario.defaults.seed++;
  expect(applicableLayaTape(scenario, scenario.defaults.seed, tape)).toBeUndefined();
});
