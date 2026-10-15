import { describe, expect, it } from 'vitest';
import { BlockType, bridgeDeckHeights, type WorldSnapshot } from '../../contracts';
import { Y_SCALE } from '../units';
import { rampAt, rampHeight } from './mesher';

/** One row: grass, road, road, bridge ×3, road, road. */
const row = (): WorldSnapshot => {
  const blocks = [BlockType.Grass, BlockType.Road, BlockType.Road, BlockType.Bridge, BlockType.Bridge, BlockType.Bridge, BlockType.Road, BlockType.Road];
  const ground = [1, 1, 1, 0, 0, 0, 1, 1];
  return { w: blocks.length, h: 1, ground: Uint8Array.from(ground), blocks: Uint8Array.from(blocks), buildingIndex: new Uint16Array(blocks.length), dirtyChunks: [] };
};

describe('bridge approach ramps', () => {
  it('climbs from road level to the deck over two cells without a step', () => {
    const w = row();
    const deck = bridgeDeckHeights(w.w, w.h, Array.from(w.ground), Array.from(w.blocks));
    const top = deck[3] * Y_SCALE;
    const far = rampAt(w, deck, 1);
    const near = rampAt(w, deck, 2);
    expect(far && near).toBeTruthy();
    if (!far || !near) return;
    expect(far.dx).toBe(1);
    expect(rampHeight(far, 0, 0.5)).toBeCloseTo(w.ground[1] * Y_SCALE);
    expect(rampHeight(far, 1, 0.5)).toBeCloseTo(rampHeight(near, 0, 0.5));
    expect(rampHeight(near, 1, 0.5)).toBeCloseTo(top);
    // Mirrored on the other bank.
    const east = rampAt(w, deck, 6);
    expect(east?.dx).toBe(-1);
    expect(east && rampHeight(east, 0, 0.5)).toBeCloseTo(top);
    expect(rampAt(w, deck, 0)).toBeNull();
  });
});
