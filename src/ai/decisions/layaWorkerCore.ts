import type { LayaCandidate } from './layaClient';

type Predict = (state: string, questions: Record<string, {
  type: 'choice'; instructions: string; criteria: Record<string, string>;
}>) => Promise<unknown>;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Laya treats relative model paths as Hugging Face repo IDs, so use an absolute URL. */
export const localLayaModelUrl = (pageHref: string): string => new URL('/models/laya', pageHref).href;

export async function evaluateLayaDecision(predict: Predict, state: string, candidates: readonly LayaCandidate[], instructions = 'Which feasible hospital should receive this simulated patient?'): Promise<{
  choice: string; probabilities: Record<string, number>;
}> {
  if (!state.trim() || state.length > 2048 || candidates.length < 1 || candidates.length > 5 || !instructions.trim() || instructions.length > 256 ||
      candidates.some((candidate) => !/^[a-z][a-z0-9_-]{0,31}$/.test(candidate.id) || !candidate.description.trim() || candidate.description.length > 256)) {
    throw new Error('Invalid Laya request');
  }
  const criteria = Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.description]));
  if (Object.keys(criteria).length !== candidates.length) throw new Error('Duplicate Laya candidates');
  const result = await predict(state, {
    hospital: { type: 'choice', instructions, criteria },
  });
  if (!record(result) || !record(result.usage) || result.usage.truncated === true ||
      (typeof result.usage.state_tokens_dropped === 'number' && result.usage.state_tokens_dropped > 0)) {
    throw new Error('Laya observation was truncated or invalid');
  }
  const answer = record(result.answers) ? result.answers.hospital : null;
  if (!record(answer) || answer.type !== 'choice' || typeof answer.choice !== 'string' ||
      !Object.hasOwn(criteria, answer.choice) || !record(answer.probabilities)) {
    throw new Error('Invalid Laya choice answer');
  }
  const probabilities: Record<string, number> = {};
  let total = 0;
  for (const id of Object.keys(criteria)) {
    const value = answer.probabilities[id];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid Laya probabilities');
    probabilities[id] = value;
    total += value;
  }
  if (Object.keys(answer.probabilities).length !== candidates.length || Math.abs(total - 1) > 0.02) {
    throw new Error('Invalid Laya probability distribution');
  }
  return { choice: answer.choice, probabilities };
}
