import { describe, expect, it } from 'vitest';
import { BlockType, DEFAULT_NPC_PARAMS } from '../../contracts';
import { ScenarioSchema } from '../../contracts/schemas';
import { checkCity } from '../persistence';
import { cityWarnings } from '../validation';
import { createSixMile, insideForest, insideSixMile } from './sixMile';
import { createEngine } from '../../worker/engines';

describe('image-inspired Six Mile district', () => {
  it('is deterministic, valid and importable by the existing editor', () => {
    const a = createSixMile(), b = createSixMile();
    expect(a).toEqual(b);
    expect(ScenarioSchema.safeParse(a.scenario).success).toBe(true);
    expect(() => checkCity(a.scenario)).not.toThrow();
    expect(a.scenario.buildings.length).toBeGreaterThan(100);
    expect(cityWarnings(a.scenario)).toEqual([]);
  });
  it('keeps every footprint on land inside the reference boundary with level foundations and road entrances', () => {
    const { scenario: s, origin } = createSixMile();
    const occupied = new Set<number>();
    for (const b of s.buildings) {
      expect([BlockType.Road, BlockType.Bridge]).toContain(s.blocks[b.entrance]);
      expect(new Set(b.cells.map(c => s.ground[c])).size).toBe(1);
      expect(b.cells.some(c => Math.abs(c - b.entrance) === s.size.w || (Math.floor(c / s.size.w) === Math.floor(b.entrance / s.size.w) && Math.abs(c - b.entrance) === 1))).toBe(true);
      for (const c of b.cells) {
        expect(occupied.has(c)).toBe(false);
        occupied.add(c);
        const x = c % s.size.w + origin.x, z = Math.floor(c / s.size.w) + origin.z;
        expect(insideSixMile(x, z)).toBe(true);
        expect(s.blocks[c]).toBe(b.type);
      }
    }
  });
  it('provides explicit decks for all crossings and valid channel flood sources', () => {
    const { scenario: s } = createSixMile();
    const decks = new Map(s.bridges?.map(b => [b.cell, b.deckHeight]));
    expect(decks.size).toBeGreaterThan(20);
    s.blocks.forEach((type, c) => { if (type === BlockType.Bridge) expect(decks.get(c)).toBeGreaterThan(s.ground[c]); });
    for (const source of s.weather.sources) expect(s.blocks[source.cell]).toBe(BlockType.WaterSource);
  });
  it('connects every building to the plant and distinguishes referenced landmarks from added sites', () => {
    const { scenario: s, places, landmarkCount } = createSixMile();
    const connected = new Set([0]);
    for (let changed = true; changed;) {
      changed = false;
      for (const [a, b] of s.powerGrid.edges) if (connected.has(a) !== connected.has(b)) { connected.add(a); connected.add(b); changed = true; }
    }
    expect(s.buildings.every(b => b.powerNode !== undefined && connected.has(b.powerNode))).toBe(true);
    expect(places.filter(p => p.source === 'reference').map(p => p.name)).toEqual(['APDCL campus', 'GNRC · Six Mile']);
    expect(landmarkCount).toBe(10);
    expect(places.length).toBe(s.buildings.length);
    expect(s.buildings.find(b => b.type === BlockType.Hospital)?.generator?.fuelTicks).toBeGreaterThan(0);
  });
  it('places APDCL in the middle with a forested campus and waterlogging hotspots', () => {
    const { scenario: s, places, origin } = createSixMile();
    const apdcl = places.find(p => p.name === 'APDCL campus')!;
    const ax = apdcl.x + origin.x, az = apdcl.z + origin.z;
    expect(ax).toBeGreaterThan(50);
    expect(ax).toBeLessThan(78);
    expect(az).toBeGreaterThan(50);
    expect(az).toBeLessThan(80);
    expect(insideForest(Math.floor(ax), Math.floor(az))).toBe(true);
    let forest = 0, trees = 0;
    for (let c = 0; c < s.blocks.length; c++) {
      const x = c % s.size.w + origin.x, z = Math.floor(c / s.size.w) + origin.z;
      if (!insideForest(x, z)) continue;
      forest++;
      if (s.blocks[c] === BlockType.Tree) trees++;
    }
    expect(forest).toBeGreaterThan(200);
    expect(trees / forest).toBeGreaterThan(0.45);
    expect(s.hotspots?.length).toBeGreaterThanOrEqual(3);
    expect(s.hotspots?.every(h => h.kind === 'waterlogging' && h.cells.length > 0)).toBe(true);
    expect(s.injected.length).toBeGreaterThanOrEqual(3);
    // Slab hugs the district — smaller than the old 128×128 empty-corner map.
    expect(s.size.w * s.size.h).toBeLessThan(128 * 128);
  });
  it.each(['core', 'preview'] as const)('loads and advances through the existing %s worker engine without mutating the city', engine => {
    const { scenario } = createSixMile(), before = JSON.stringify(scenario);
    const sim = createEngine(engine, scenario, 27, { dispatchMode: 'negotiation', npcParams: DEFAULT_NPC_PARAMS, maxTicks: 20, startTimeSeconds: 28800 });
    for (let t = 0; t < 20; t++) sim.step();
    expect(sim.snapshot().tick).toBe(20);
    expect(sim.world().blocks.length).toBe(scenario.size.w * scenario.size.h);
    expect(sim.notes).toEqual([]);
    expect(JSON.stringify(scenario)).toBe(before);
  }, 15000);
});
