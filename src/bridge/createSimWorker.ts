/**
 * The one place that decides which worker runs the simulation. The engine
 * inside it (AK core or preview model) is picked per run via `RunOptions.engine`.
 */
export const createSimWorker = (): Worker =>
  new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module', name: 'floodsim' });
