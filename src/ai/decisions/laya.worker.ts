import { Agent } from 'laya-ts';
import { evaluateLayaDecision, localLayaModelUrl } from './layaWorkerCore';
import type { LayaCandidate } from './layaClient';

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;
let agentPromise: Promise<Agent> | null = null;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function load(id: number, generation: number): Promise<Agent> {
  const modelUrl = localLayaModelUrl(globalThis.location.href);
  agentPromise ??= Agent.load(modelUrl, {
    onProgress: (done, total, file) => scope.postMessage({ type: 'progress', id, generation, done, total, file }),
  }).catch((error: unknown) => {
    agentPromise = null;
    throw error;
  });
  return agentPromise;
}

scope.onmessage = (event) => {
  const message = event.data;
  if (!record(message) || !Number.isSafeInteger(message.id) || !Number.isSafeInteger(message.generation) ||
      (message.type !== 'load' && message.type !== 'predict')) return;
  const id = message.id as number;
  const generation = message.generation as number;
  void (async () => {
    try {
      const agent = await load(id, generation);
      if (message.type === 'load') {
        scope.postMessage({ type: 'ready', id, generation });
        return;
      }
      if (typeof message.state !== 'string' || !Array.isArray(message.candidates) ||
          message.candidates.some((candidate) => !record(candidate) || typeof candidate.id !== 'string' || typeof candidate.description !== 'string')) {
        throw new Error('Invalid Laya worker request');
      }
      const candidates = message.candidates as LayaCandidate[];
      const start = performance.now();
      const result = await evaluateLayaDecision((state, questions) => agent.predict(state, questions), message.state, candidates);
      scope.postMessage({ type: 'prediction', id, generation, ...result, durationMs: performance.now() - start });
    } catch (error) {
      scope.postMessage({ type: 'error', id, generation, message: error instanceof Error ? error.message : String(error) });
    }
  })();
};
