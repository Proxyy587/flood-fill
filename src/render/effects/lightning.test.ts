import { describe, expect, it } from 'vitest';
import { lightningFlash, strikeChance, strikesBetween } from './lightning';

describe('lightning', () => {
  it('never strikes in light rain', () => {
    expect(strikeChance(0.4)).toBe(0);
    expect(strikesBetween(0, 600_000, 0.4)).toEqual([]);
  });

  it('strikes often in a downpour, and the flash matches each strike', () => {
    const strikes = strikesBetween(0, 600_000, 0.95);
    expect(strikes.length).toBeGreaterThan(60);
    for (const s of strikes.slice(0, 10)) {
      expect(lightningFlash(s.at + 40, 0.95)).toBeGreaterThan(0.3);
      expect(lightningFlash(s.at - 1, 0.95)).toBe(0);
    }
  });

  it('is deterministic and splits cleanly across windows', () => {
    const whole = strikesBetween(0, 100_000, 0.8);
    const parts = [...strikesBetween(0, 37_000, 0.8), ...strikesBetween(37_000, 100_000, 0.8)];
    expect(parts).toEqual(whole);
  });
});
