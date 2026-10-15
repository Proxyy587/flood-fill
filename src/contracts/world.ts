import { BlockType } from './blocks';

/** A bridge deck sits this many voxels above the highest bank it connects. */
export const BRIDGE_DECK_CLEARANCE = 2;

/** Ticks (seconds) each signal axis stays green, the last `SIGNAL_AMBER_TICKS` of them amber. */
export const SIGNAL_GREEN_TICKS = 20;
export const SIGNAL_AMBER_TICKS = 3;

/**
 * A signalised junction: a road cell meeting three or more roads that is not
 * the inside of a paved plaza. Shared so the sim and renderer agree on where signals are.
 */
export const isSignalJunction = (w: number, h: number, blocks: ArrayLike<number>, c: number): boolean => {
  if (blocks[c] !== BlockType.Road) return false;
  const x = c % w;
  const z = (c - x) / w;
  const road = (xx: number, zz: number) => xx >= 0 && zz >= 0 && xx < w && zz < h && (blocks[zz * w + xx] === BlockType.Road || blocks[zz * w + xx] === BlockType.Bridge);
  const k = +road(x + 1, z) + +road(x - 1, z) + +road(x, z + 1) + +road(x, z - 1);
  let paved = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) paved += +road(x + dx, z + dz);
  return k >= 3 && paved <= 5;
};

/**
 * Which axis has green at a junction: 'x' (east–west traffic) or 'z' (north–south).
 * Neighbouring 8×8 blocks alternate, so the city does not switch in lockstep.
 */
export const signalPhase = (tick: number, c: number, w: number): { green: 'x' | 'z'; amber: boolean } => {
  const x = c % w;
  const z = (c - x) / w;
  const t = tick + ((x >> 3) + (z >> 3)) * 7;
  const cycle = Math.floor(t / SIGNAL_GREEN_TICKS);
  return { green: cycle % 2 === 0 ? 'x' : 'z', amber: t % SIGNAL_GREEN_TICKS >= SIGNAL_GREEN_TICKS - SIGNAL_AMBER_TICKS };
};

/**
 * Deck height (voxels) for every bridge cell, -1 elsewhere. Each connected
 * bridge span gets one level: its highest non-bridge neighbour + clearance.
 */
export const bridgeDeckHeights = (
  w: number,
  h: number,
  ground: ArrayLike<number>,
  blocks: ArrayLike<number>,
): Int16Array => {
  const n = w * h;
  const deck = new Int16Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  const span: number[] = [];
  for (let start = 0; start < n; start++) {
    if (blocks[start] !== BlockType.Bridge || seen[start]) continue;
    span.length = 0;
    stack.push(start);
    seen[start] = 1;
    let bank = 0;
    while (stack.length) {
      const c = stack.pop() as number;
      span.push(c);
      const x = c % w;
      const z = (c - x) / w;
      const nbs = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, z > 0 ? c - w : -1, z < h - 1 ? c + w : -1];
      for (const nb of nbs) {
        if (nb < 0) continue;
        if (blocks[nb] === BlockType.Bridge) {
          if (!seen[nb]) {
            seen[nb] = 1;
            stack.push(nb);
          }
        } else if (blocks[nb] !== BlockType.WaterSource) {
          bank = Math.max(bank, ground[nb]);
        }
      }
    }
    for (const c of span) deck[c] = bank + BRIDGE_DECK_CLEARANCE;
  }
  return deck;
};
