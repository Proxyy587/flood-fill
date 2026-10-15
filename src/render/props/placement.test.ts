import { describe, expect, it } from 'vitest';
import { BlockType, type WorldSnapshot } from '../../contracts';
import { mockScenario } from '../../contracts/mocks';
import { lampCells } from '../effects/StreetLights';
import { columnTop, PROP_HEIGHT } from '../terrain/mesher';
import { findSites, fitMultiplier, yawFor } from './placement';

const world = (w: number, h: number, paint: (c: number, x: number, z: number) => [BlockType, number]): WorldSnapshot => {
  const blocks = new Uint8Array(w * h);
  const buildingIndex = new Uint16Array(w * h);
  for (let c = 0; c < w * h; c++) {
    const [b, idx] = paint(c, c % w, Math.floor(c / w));
    blocks[c] = b;
    buildingIndex[c] = idx;
  }
  return { w, h, ground: new Uint8Array(w * h).fill(2), blocks, buildingIndex, dirtyChunks: [] };
};

describe('model placement for police stations', () => {
  // 2×2 station at x 2..3, z 2..3; road along z = 4 (south of it).
  const w = world(8, 8, (_, x, z) => {
    if (x >= 2 && x <= 3 && z >= 2 && z <= 3) return [BlockType.PoliceStation, 6];
    if (z === 4) return [BlockType.Road, 0];
    return [BlockType.Grass, 0];
  });

  it('finds each station with its footprint and faces the street', () => {
    const [site] = findSites(w, BlockType.PoliceStation);
    expect(site).toMatchObject({ building: 5, x0: 2, x1: 3, z0: 2, z1: 3, ground: 2, facing: { dx: 0, dz: 1 } });
    expect(site.cells).toHaveLength(4);
  });

  it('turns a +x-facing model toward the street', () => {
    const yaw = yawFor({ dx: 0, dz: 1 });
    // three.js: rotation.y = θ maps +x to (cos θ, 0, −sin θ).
    expect(Math.cos(yaw)).toBeCloseTo(0);
    expect(-Math.sin(yaw)).toBeCloseTo(1);
  });

  it('fits inside the footprint and under the height cap', () => {
    const [site] = findSites(w, BlockType.PoliceStation);
    const k = fitMultiplier(site, { depth: 5, width: 4.5, height: 6.8 }, 8);
    expect(5 * k).toBeLessThanOrEqual(8);
    expect(4.5 * k).toBeLessThanOrEqual(8);
    expect(6.8 * k).toBeLessThanOrEqual(8 + 1e-9);
  });

  it('reports the model height for labels and picking, not the plinth', () => {
    const c = 2 * 8 + 2;
    expect(columnTop(w, c)).toBeGreaterThanOrEqual(2 + (PROP_HEIGHT[BlockType.PoliceStation] ?? 0));
  });

  it('places the preview city stations and street lamps', () => {
    const s = mockScenario();
    const buildingIndex = new Uint16Array(s.size.w * s.size.h);
    for (const b of s.buildings) for (const c of b.cells) buildingIndex[c] = b.id + 1;
    const city: WorldSnapshot = { w: s.size.w, h: s.size.h, ground: Uint8Array.from(s.ground), blocks: Uint8Array.from(s.blocks), buildingIndex, dirtyChunks: [] };
    const sites = findSites(city, BlockType.PoliceStation);
    expect(sites.length).toBe(s.buildings.filter((b) => b.type === BlockType.PoliceStation).length);
    const lamps = lampCells(city);
    expect(lamps.length).toBeGreaterThan(30);
    expect(lamps.every((c) => city.blocks[c] === BlockType.Road)).toBe(true);
  });
});
