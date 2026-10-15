import { describe, expect, it } from 'vitest';
import { SUNRISE, SUNSET, daylightAt } from './daylight';

describe('daylight (render-only clock)', () => {
  it('is full day at noon and full night at midnight', () => {
    expect(daylightAt(12.5 * 3600).day).toBeCloseTo(1);
    expect(daylightAt(0).day).toBe(0);
    expect(daylightAt(23 * 3600).day).toBe(0);
  });

  it('rises in the east and sets in the west', () => {
    const morning = daylightAt(SUNRISE + 1800);
    const evening = daylightAt(SUNSET - 1800);
    expect(morning.sun.x).toBeGreaterThan(0.5);
    expect(evening.sun.x).toBeLessThan(-0.5);
    expect(morning.sun.y).toBeGreaterThan(0);
    expect(daylightAt(12.5 * 3600).sun.y).toBeGreaterThan(0.85);
  });

  it('turns golden near sunset and is dark an hour after it', () => {
    expect(daylightAt(SUNSET - 900).golden).toBeGreaterThan(0.3);
    expect(daylightAt(12 * 3600).golden).toBe(0);
    expect(daylightAt(SUNSET + 3600).day).toBeLessThan(0.05);
  });

  it('wraps times past midnight', () => {
    expect(daylightAt(86400 + 12 * 3600).day).toBeCloseTo(daylightAt(12 * 3600).day);
    expect(daylightAt(-3600).seconds).toBe(23 * 3600);
  });

  it('marks clear morning, afternoon and midnight phases', () => {
    expect(daylightAt(8 * 3600).morning).toBeGreaterThan(0.5);
    expect(daylightAt(8 * 3600).afternoon).toBeLessThan(0.2);
    expect(daylightAt(14 * 3600).afternoon).toBeGreaterThan(0.5);
    expect(daylightAt(14 * 3600).morning).toBeLessThan(0.2);
    expect(daylightAt(0).midnight).toBeGreaterThan(0.7);
    expect(daylightAt(12 * 3600).midnight).toBe(0);
  });
});
