/** Seeded PRNG for mocks (mulberry32). The real sim uses `src/sim/rng.ts`. */
export interface MockRng {
  next(): number;
  range(min: number, max: number): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

export const createMockRng = (seed: number): MockRng => {
  let a = seed >>> 0 || 0x9e3779b9;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  };
};
