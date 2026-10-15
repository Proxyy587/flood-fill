import { describe, expect, it } from 'vitest';
import { BlockType, bridgeDeckHeights, type WorldSnapshot } from '../../contracts';
import { buildChunk, windowLit } from './mesher';

const flatWorld = (w: number, h: number, block = BlockType.Grass, groundH = 2): WorldSnapshot => ({
  w,
  h,
  ground: new Uint8Array(w * h).fill(groundH),
  blocks: new Uint8Array(w * h).fill(block),
  buildingIndex: new Uint16Array(w * h),
  dirtyChunks: [],
});

const quads = (m: { indices: Uint32Array }) => m.indices.length / 6;

describe('chunk mesher', () => {
  it('culls faces between equal-height columns', () => {
    const world = flatWorld(4, 4);
    const { solid, windows } = buildChunk(world, bridgeDeckHeights(4, 4, world.ground, world.blocks), 0, 0);
    // 16 tops + 4 edges × 4 cells of map-edge skirt.
    expect(quads(solid)).toBe(16 + 16);
    expect(quads(windows)).toBe(0);
  });

  it('emits walls and windows only on the outside of a multi-cell building', () => {
    const world = flatWorld(4, 4);
    const cells = [5, 6, 9, 10];
    for (const c of cells) {
      world.blocks[c] = BlockType.Office;
      world.buildingIndex[c] = 1;
    }
    const { solid, windows } = buildChunk(world, bridgeDeckHeights(4, 4, world.ground, world.blocks), 0, 0);
    // 8 exterior wall faces × 10 window rows × 2 panes.
    expect(quads(windows)).toBe(8 * 10 * 2);
    // Every vertex is tagged with an in-grid cell.
    expect(Math.max(...solid.cells)).toBeLessThan(16);
    expect(solid.positions.length / 3).toBe(solid.roles.length);
  });

  it('normals agree with triangle winding (outward faces)', () => {
    const world = flatWorld(3, 3);
    world.blocks[4] = BlockType.House;
    world.buildingIndex[4] = 1;
    const { solid } = buildChunk(world, bridgeDeckHeights(3, 3, world.ground, world.blocks), 0, 0);
    const p = solid.positions;
    for (let t = 0; t < solid.indices.length; t += 3) {
      const [a, b, c] = [solid.indices[t], solid.indices[t + 1], solid.indices[t + 2]];
      const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
      const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const n = [solid.normals[a * 3], solid.normals[a * 3 + 1], solid.normals[a * 3 + 2]];
      const dot = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2];
      const area = Math.hypot(cross[0], cross[1], cross[2]);
      if (area > 1e-9) expect(dot).toBeGreaterThan(0);
    }
  });

  it('emits no zero-length normals (they light as NaN and the bloom spreads them)', () => {
    const world = flatWorld(16, 16, BlockType.Road);
    world.blocks[5 * 16 + 8] = BlockType.Bridge;
    world.ground[5 * 16 + 8] = 4;
    const deck = bridgeDeckHeights(16, 16, world.ground, world.blocks);
    const { solid } = buildChunk(world, deck, 0, 0);
    for (let i = 0; i < solid.normals.length; i += 3) expect(Math.hypot(solid.normals[i], solid.normals[i + 1], solid.normals[i + 2])).toBeGreaterThan(0.99);
  });
});

describe('windowLit', () => {
  it('is deterministic and leaves roughly a third of panes dark', () => {
    let dark = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const v = windowLit(i, i % 7, i % 2, 'px');
      expect(v).toBe(windowLit(i, i % 7, i % 2, 'px'));
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1.05);
      if (v < 0.1) dark++;
    }
    expect(dark / n).toBeGreaterThan(0.25);
    expect(dark / n).toBeLessThan(0.45);
  });
});
