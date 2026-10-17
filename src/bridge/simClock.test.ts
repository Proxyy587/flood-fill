import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKER_SPEED,
  MAX_WORKER_SPEED,
  nearestMultiplier,
  SIM_SECONDS_PER_WALL_SECOND_AT_1X,
  workerSpeed,
} from './simClock';

describe('presentation clock', () => {
  it('maps 1× to one simulated hour per wall-minute', () => {
    expect(SIM_SECONDS_PER_WALL_SECOND_AT_1X).toBe(60);
    expect(workerSpeed(1)).toBe(60);
    expect(workerSpeed(16)).toBe(960);
    expect(DEFAULT_WORKER_SPEED).toBe(240);
    expect(MAX_WORKER_SPEED).toBe(960);
  });

  it('snaps worker speeds back to UI multipliers', () => {
    expect(nearestMultiplier(60)).toBe(1);
    expect(nearestMultiplier(240)).toBe(4);
    expect(nearestMultiplier(900)).toBe(16);
  });
});
