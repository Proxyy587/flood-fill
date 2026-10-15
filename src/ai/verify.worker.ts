/// <reference lib="webworker" />
import type { Scenario, ScenarioPatch } from '../contracts';
import { compareDispatch, verifyPatch, type Verification, type VerifyOptions } from './verify';

/** `patch` verifies a proposal; without it the worker compares the two dispatch modes. */
export type VerifyRequest = { id: number; scenario: Scenario; patch: ScenarioPatch | null; options: Omit<VerifyOptions, 'onProgress'> };
export type VerifyReply = { id: number; type: 'progress'; done: number; total: number } | { id: number; type: 'result'; result: Verification } | { id: number; type: 'error'; message: string };

const post = (msg: VerifyReply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = (e: MessageEvent<VerifyRequest>) => {
  const { id, scenario, patch, options } = e.data;
  try {
    const o = { ...options, onProgress: (done: number, total: number) => post({ id, type: 'progress', done, total }) };
    const result = patch ? verifyPatch(scenario, patch, o) : compareDispatch(scenario, o);
    post({ id, type: 'result', result });
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
