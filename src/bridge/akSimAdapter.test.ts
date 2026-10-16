import { describe, expect, it } from 'vitest';
import { createSimulation } from '../sim';
import { mockScenario } from '../contracts/mocks';
import { toAkScenario, toUiSnapshot, toWorldSnapshot } from './akSimAdapter';

describe('AK simulator bridge adapter', () => {
  it('runs the real deterministic AK simulator from the UI scenario and adapts its snapshots', () => {
    const scenario = mockScenario();
    const sim = createSimulation(toAkScenario(scenario), 42, scenario.defaults.dispatchMode, { durationTicks: 12 });
    sim.step();
    const snapshot = toUiSnapshot(sim.snapshot(), scenario);
    const world = toWorldSnapshot(scenario);

    expect(snapshot.tick).toBe(1);
    expect(snapshot.weather.rain).toBe(0);
    expect(snapshot.weather.wind).toBeGreaterThan(0);
    expect(world.dirtyChunks.length).toBeGreaterThan(0);
    expect(sim.summary().events[0].reason).not.toMatch(/MOCK/i);
    expect(sim.summary().events[0].data?.dispatchImplemented).toBe(true);
  });

  it('translates UI injection time/target fields into AK runner event shape', () => {
    const scenario = mockScenario();
    scenario.injected = [{ t: 5, kind: 'boat_failure', target: 3 }];

    expect(toAkScenario(scenario).injected).toEqual([{ tick: 5, kind: 'boat_failure', vehicleId: 3 }]);
  });

  it('rejects helicopter injections until the AK runner supports them instead of fabricating conditions', () => {
    const scenario = mockScenario();
    scenario.injected = [{ t: 5, kind: 'helicopter_grounded_wind', durationTicks: 10 }];

    expect(() => toAkScenario(scenario)).toThrow('not supported by the current AK simulation runner');
  });
});
