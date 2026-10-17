/**
 * Presentation clock: at 1×, one wall-clock minute advances one simulated hour.
 * Speed multipliers (1–16×) scale that base rate for demos.
 *
 * Worker `speed` is still "simulated seconds per wall second".
 */

/** Simulated seconds advanced per wall second at the 1× presentation rate. */
export const SIM_SECONDS_PER_WALL_SECOND_AT_1X = 60;

/** UI speed stops shown on the transport slider. */
export const SPEED_MULTIPLIERS = [1, 2, 4, 8, 16] as const;
export type SpeedMultiplier = (typeof SPEED_MULTIPLIERS)[number];

/** Comfortable default for a 24 h storm (~6 wall minutes at this rate). */
export const DEFAULT_SPEED_MULTIPLIER: SpeedMultiplier = 4;

export const MAX_SPEED_MULTIPLIER: SpeedMultiplier = 16;

/** Convert a UI multiplier into the worker's ticks-per-wall-second speed. */
export const workerSpeed = (multiplier: number): number =>
  Math.max(SIM_SECONDS_PER_WALL_SECOND_AT_1X, Math.round(multiplier * SIM_SECONDS_PER_WALL_SECOND_AT_1X));

export const DEFAULT_WORKER_SPEED = workerSpeed(DEFAULT_SPEED_MULTIPLIER);
export const MAX_WORKER_SPEED = workerSpeed(MAX_SPEED_MULTIPLIER);

export const nearestMultiplier = (workerSpeedValue: number): SpeedMultiplier => {
  const target = workerSpeedValue / SIM_SECONDS_PER_WALL_SECOND_AT_1X;
  let best: SpeedMultiplier = SPEED_MULTIPLIERS[0];
  let bestDist = Math.abs(target - best);
  for (const stop of SPEED_MULTIPLIERS) {
    const dist = Math.abs(target - stop);
    if (dist < bestDist) {
      best = stop;
      bestDist = dist;
    }
  }
  return best;
};
