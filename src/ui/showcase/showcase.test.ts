import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../contracts';
import { mockRunSummary } from '../../contracts/mocks';
import { beaconDetail, beaconTitle, SHOWCASE, showcaseOf } from './catalog';

const ev = (type: SimEvent['type'], extra: Partial<SimEvent> = {}): SimEvent => ({ tick: 10, type, reason: 'why', ...extra });

describe('showcase catalog', () => {
  it('maps events to checklist entries, honouring per-entry filters', () => {
    expect(showcaseOf(ev('WATERLOGGING'))?.id).toBe('waterlog');
    expect(showcaseOf(ev('INJECTED', { data: { kind: 'bridge_closed' } }))?.id).toBe('bridge');
    expect(showcaseOf(ev('INJECTED', { data: { kind: 'comms_outage' } }))?.id).toBe('comms');
    expect(showcaseOf(ev('INJECTED', { data: { kind: 'boat_failure' } }))).toBeNull();
    expect(showcaseOf(ev('HELI_DROPOFF', { reason: 'flown to St. Avery: 3/40 beds' }))?.id).toBe('admit');
    expect(showcaseOf(ev('HELI_DROPOFF', { reason: 'flown to the relief camp' }))).toBeNull();
    expect(showcaseOf(ev('REROUTE'))).toBeNull();
  });

  it('titles cards from event data and trims long reasons', () => {
    const e = ev('ROADBLOCK', { data: { name: 'Ghat Road' } });
    const entry = showcaseOf(e);
    expect(entry && beaconTitle(e, entry)).toBe('Roadblock: Ghat Road');
    expect(beaconDetail(ev('WEATHER', { reason: `${'x'.repeat(200)}` })).length).toBeLessThanOrEqual(96);
  });

  it('the showcase city plays every set piece in one storm', () => {
    const { events } = mockRunSummary(3600, 7);
    const seen = new Set(events.map(showcaseOf).flatMap((s) => (s ? [s.id] : [])));
    const missing = SHOWCASE.filter((s) => !seen.has(s.id)).map((s) => s.id);
    expect(missing).toEqual([]);
    const first = (type: SimEvent['type']) => events.find((e) => e.type === type)?.tick ?? Infinity;
    // The story reads in order: warning, then water, then the system responding.
    expect(first('FLOOD_ALERT')).toBeLessThan(first('WATERLOGGING'));
    expect(first('WATERLOGGING')).toBeLessThan(first('ROADBLOCK'));
    expect(first('INJURY_REPORTED')).toBeLessThan(first('AMBULANCE_DISPATCH') + 1);
    expect(first('AMBULANCE_DISPATCH')).toBeLessThan(first('HOSPITAL_ASSIGN'));
    expect(first('TEAMS_DEPLOYED')).toBeLessThan(first('ROOFTOP_RESCUE'));
  }, 30000);
});
