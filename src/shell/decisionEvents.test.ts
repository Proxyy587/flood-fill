import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../contracts';
import { selectDecisionEntries, selectDecisionEvents } from './decisionEvents';

const event = (tick: number, type: string, reason = `Actual ${type} decision`, data?: SimEvent['data']): SimEvent => ({ tick, type: type as SimEvent['type'], reason, data });

describe('selectDecisionEvents', () => {
  it('keeps decisions and outcomes from rescue, hospital, police, evacuation and civilian logic', () => {
    const events = [
      event(1, 'REQUEST_CREATED'),
      event(2, 'ASSIGNED', 'Finite boat assigned because road access is blocked'),
      event(3, 'HOSPITAL_ASSIGN', 'Field triage selected and reserved the operational hospital bed'),
      event(4, 'ARRIVED', 'Police escort reached the safe roadside waypoint'),
      event(5, 'NPC_STATE', 'Scene-triaged civilian boarded a rescue boat'),
      event(6, 'SERVED', 'Civilian admitted to the reserved hospital bed'),
      event(7, 'EVAC_ORDER', 'Civilian accepted an evacuation order and reserved shelter capacity'),
    ];

    expect(selectDecisionEvents(events, 10)).toEqual(events.slice().reverse());
  });

  it('does not show ambient telemetry, run markers, or explicitly mocked events', () => {
    const events = [
      event(1, 'WEATHER', 'Rain intensity changed'),
      event(2, 'RUN_STARTED', 'Simulation started'),
      event(3, 'ASSIGNED', 'MOCK assignment for consumer development', { mock: true }),
    ];

    expect(selectDecisionEvents(events)).toEqual([]);
  });

  it('ignores a malformed event reason without crashing the panel selector', () => {
    const malformed = { ...event(2, 'ASSIGNED'), reason: undefined } as unknown as SimEvent;
    const valid = event(1, 'HOSPITAL_ASSIGN');

    expect(selectDecisionEvents([malformed, valid])).toEqual([valid]);
  });

  it('sorts newest first and caps the timeline length', () => {
    const events = [1, 3, 2, 5, 4, 7, 6].map((tick) => event(tick, 'ASSIGNED'));

    expect(selectDecisionEvents(events, 3).map((item) => item.tick)).toEqual([7, 6, 5]);
  });

  it('keeps same-tick decisions from one responder on distinct stable row keys', () => {
    const first = { ...event(12, 'BID'), actor: 4 as SimEvent['actor'], actorKind: 'vehicle' as const, target: 8 as SimEvent['target'], targetKind: 'request' as const };
    const second = { ...event(12, 'BID'), actor: 4 as SimEvent['actor'], actorKind: 'vehicle' as const, target: 9 as SimEvent['target'], targetKind: 'request' as const };
    const entries = selectDecisionEntries([first, second]);

    expect(entries.map((entry) => entry.event)).toEqual([second, first]);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(2);
    expect(entries.map((entry) => entry.key)).toEqual(selectDecisionEntries([first, second, event(13, 'SERVED')]).slice(1).map((entry) => entry.key));
  });
});
