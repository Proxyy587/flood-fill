/**
 * The one place that decides which sim runs in the worker.
 * When AK's `src/sim/worker.ts` speaks `src/contracts/messages.ts`, point the URL at it.
 */
export const createSimWorker = (): Worker =>
  new Worker(new URL('./mockSim.worker.ts', import.meta.url), { type: 'module', name: 'floodsim' });
