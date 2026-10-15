import { describe, expect, it } from 'vitest';
import { asBuildingId, type MetricsFrame, type SimEvent } from '../../contracts';
import { buildNews, OUTLETS, type NewsContext } from './headlines';

const ctx: NewsContext = { city: 'Riverside', districtAt: (c) => (c < 100 ? 'Old Town' : 'Ghat Road'), buildingName: (id) => (id === 7 ? 'North Substation' : undefined) };
const ev = (tick: number, type: SimEvent['type'], extra: Partial<SimEvent> = {}): SimEvent => ({ tick, type, reason: `${type} reason`, ...extra });
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
  ...over,
});

describe('buildNews', () => {
  const events = [
    ev(30, 'WEATHER', { data: { rain: 0.9, wind: 0.3 } }),
    ev(400, 'POWER_TRIP', { cell: 20, actor: asBuildingId(7), actorKind: 'building' }),
    ev(500, 'TEAMS_DEPLOYED', { cell: 150, data: { teams: 3, rescuers: 12 } }),
    ev(610, 'SERVED'),
    ev(620, 'ROOFTOP_RESCUE'),
    ev(1300, 'LOCAL_FLOOD', { cell: 120 }),
  ];
  const metrics = [frame(100), frame(800, { unpoweredPopPct: 55, homesFlooded: 30, residentsAffected: 120 })];
  const news = buildNews(events, metrics, ctx);

  it('turns events into named, placed headlines', () => {
    expect(news.find((n) => n.tick === 30 && n.kind === 'breaking')?.headline).toMatch(/Riverside/);
    expect(news.find((n) => n.headline === 'Power cut in Old Town after flooding at North Substation')).toMatchObject({ kind: 'breaking', source: OUTLETS.tv, cell: 20 });
    expect(news.find((n) => n.source === OUTLETS.control && n.headline.startsWith('3 SDRF boat teams'))).toBeDefined();
    expect(news.find((n) => n.headline === 'Streets flooding in Ghat Road')).toBeDefined();
  });

  it('adds resident posts and rescue round-ups', () => {
    expect(news.some((n) => n.kind === 'social' && n.source.startsWith('@'))).toBe(true);
    expect(news.find((n) => n.headline.startsWith('2 people brought to safety'))).toMatchObject({ tick: 1200, tone: 'good' });
  });

  it('marks metric milestones once each', () => {
    expect(news.filter((n) => n.headline.includes('in the dark') || n.headline.includes('without power'))).toHaveLength(2);
    expect(news.filter((n) => n.headline.includes('homes flooded across'))).toHaveLength(1);
  });

  it('is deterministic, sorted by time and keeps keys stable as the log grows', () => {
    expect(buildNews(events, metrics, ctx)).toEqual(news);
    expect(news.map((n) => n.tick)).toEqual([...news.map((n) => n.tick)].sort((a, b) => a - b));
    const shorter = buildNews(events.slice(0, 3), [], ctx).map((n) => n.key);
    const keys = new Set(news.map((n) => n.key));
    expect(shorter.every((k) => keys.has(k))).toBe(true);
    expect(keys.size).toBe(news.length);
  });
});
