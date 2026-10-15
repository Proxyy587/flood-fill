/**
 * Lightning schedule in wall-clock time, shared by the renderer (flash) and the
 * sound engine (thunder) so they agree. Wall time rather than sim time keeps
 * strikes at a natural pace at any run speed. Visual only; never affects the sim.
 */

const SLOT_MS = 5000;
const FLASH_MS = 520;

const hash = (n: number, salt: number): number => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Chance of a strike in a slot: none below moderate rain, frequent in a downpour. */
export const strikeChance = (rain: number): number => Math.min(0.85, Math.max(0, (rain - 0.5) * 1.9));

export interface Strike {
  at: number;
  /** 0..1, how close: brighter flash, louder and sooner thunder. */
  power: number;
}

const strikeInSlot = (slot: number, rain: number): Strike | null => {
  if (hash(slot, 1) >= strikeChance(rain)) return null;
  return { at: slot * SLOT_MS + hash(slot, 2) * (SLOT_MS - FLASH_MS), power: 0.35 + 0.65 * hash(slot, 3) };
};

/** Strikes that begin in [t0, t1). */
export function strikesBetween(t0: number, t1: number, rain: number): Strike[] {
  const out: Strike[] = [];
  for (let slot = Math.floor(t0 / SLOT_MS); slot * SLOT_MS < t1; slot++) {
    const s = strikeInSlot(slot, rain);
    if (s && s.at >= t0 && s.at < t1) out.push(s);
  }
  return out;
}

/** Flash brightness 0..1 at wall time `t`: a bright stroke, a dip and a return stroke. */
export function lightningFlash(t: number, rain: number): number {
  const s = strikeInSlot(Math.floor(t / SLOT_MS), rain);
  if (!s) return 0;
  const dt = t - s.at;
  if (dt < 0 || dt > FLASH_MS) return 0;
  const first = Math.max(0, 1 - Math.abs(dt - 40) / 60);
  const second = 0.7 * Math.max(0, 1 - Math.abs(dt - 170) / 80);
  const tail = 0.25 * Math.max(0, 1 - (dt - 200) / (FLASH_MS - 200)) * (dt > 200 ? 1 : 0);
  return Math.min(1, (first + second + tail) * s.power);
}
