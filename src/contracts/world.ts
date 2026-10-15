import { BlockType } from './blocks';

/** A bridge deck sits this many voxels above the highest bank it connects. */
export const BRIDGE_DECK_CLEARANCE = 2;

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
