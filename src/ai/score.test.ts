import { describe, expect, it } from 'vitest';
import { asBuildingId, BlockType, type BuildingDef, type MetricsFrame, type SimEvent } from '../contracts';
import { residentsOf, scoreRun, weakestParts } from './score';

const frame = (tick: number, over: Partial<MetricsFrame> = {}): MetricsFrame => ({
  tick,
  tts: { mean: 0, p50: 0, p90: 0 },
  unmet: 0,
  idleFrac: {},
  routeViolations: 0,
  gini: 0,
  hospitals: [],
  evacDonePct: 0,
  stranded: 0,
  unpoweredPopPct: 0,
  floodedCells: 0,
  maxDepth: 0,
  gridlockCells: 0,
  heliRescues: 0,
  homesFlooded: 0,
  residentsAffected: 0,
  roadsClosedPct: 0,
  ...over,
});

const event = (type: SimEvent['type'], tick = 0): SimEvent => ({ tick, type, reason: type });

const house = (id: number, capacity: number): BuildingDef => ({ id: asBuildingId(id), type: BlockType.House, cells: [id], entrance: id, capacity, floorHeight: 0.5 });
const city = { population: { count: 200 }, buildings: [house(1, 100), house(2, 100)] } as Parameters<typeof scoreRun>[1];

describe('scoreRun', () => {
  it('gives a calm run an A', () => {
    const s = scoreRun({ metrics: [frame(0), frame(10)], events: [] }, city);
    expect(s.total).toBe(100);
    expect(s.grade).toBe('A');
    expect(s.parts.map((p) => p.key)).toEqual(['lives', 'homes', 'response', 'mobility', 'power', 'care']);
  });

  it('falls as homes flood, people are trapped and power fails', () => {
    const bad = scoreRun(
      {
        metrics: [frame(0), frame(10, { homesFlooded: 1, residentsAffected: 100, stranded: 10, unpoweredPopPct: 60, roadsClosedPct: 40 })],
        events: Array.from({ length: 12 }, () => event('NPC_STRANDED')),
      },
      city,
    );
    expect(bad.total).toBeLessThan(50);
    expect(['D', 'F']).toContain(bad.grade);
    expect(weakestParts(bad, 2).map((p) => p.key)).toContain('homes');
  });

  it('leaves out parts an engine does not report and rescales the weights', () => {
    const core = frame(10);
    delete core.homesFlooded;
    delete core.residentsAffected;
    delete core.roadsClosedPct;
    const s = scoreRun({ metrics: [core], events: [] }, city);
    expect(s.parts.some((p) => p.key === 'homes')).toBe(false);
    expect(s.total).toBe(100);
  });

  it('counts residents in houses and apartments only', () => {
    expect(residentsOf({ buildings: [house(1, 30), { ...house(2, 400), type: BlockType.Hospital }] })).toBe(30);
  });
});
