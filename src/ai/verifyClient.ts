import type { Scenario, ScenarioPatch } from '../contracts';
import type { Verification, VerifyOptions } from './verify';
import type { VerifyReply, VerifyRequest } from './verify.worker';

let worker: Worker | null = null;
let nextId = 1;

/**
 * Runs `verifyPatch` (or, with `patch: null`, the dispatch-mode comparison) in a dedicated worker
 * so the city keeps rendering while seeds re-run.
 */
export function verifyInWorker(scenario: Scenario, patch: ScenarioPatch | null, options: Omit<VerifyOptions, 'onProgress'>, onProgress?: (done: number, total: number) => void): Promise<Verification> {
  worker ??= new Worker(new URL('./verify.worker.ts', import.meta.url), { type: 'module', name: 'floodsim-verify' });
  const w = worker;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<VerifyReply>) => {
      if (e.data.id !== id) return;
      if (e.data.type === 'progress') return onProgress?.(e.data.done, e.data.total);
      w.removeEventListener('message', onMessage);
      if (e.data.type === 'result') resolve(e.data.result);
      else reject(new Error(e.data.message));
    };
    w.addEventListener('message', onMessage);
    const request: VerifyRequest = { id, scenario, patch, options };
    w.postMessage(request);
  });
}
