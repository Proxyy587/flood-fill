import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NPC_PARAMS, type Scenario } from '../contracts';
import { mockScenario } from '../contracts/mocks';
import { CoreEngine } from './engines';
import { createSimulation } from '../sim/runner';

describe('CoreEngine', () => {
  it('accepts boat failures that the AK runner implements', () => {
    const engine = new CoreEngine(mockScenario(), 5, {
      dispatchMode: 'negotiation',
      npcParams: DEFAULT_NPC_PARAMS,
      maxTicks: 20,
      startTimeSeconds: 28_800,
    });

    expect(engine.rejects({ kind: 'boat_failure', t: 1, target: 1 })).toBeNull();
  });

  it('explains that dynamic rescue-team release is not implemented by core', () => {
    const engine = new CoreEngine(mockScenario(), 5, {
      dispatchMode: 'negotiation',
      npcParams: DEFAULT_NPC_PARAMS,
      maxTicks: 20,
      startTimeSeconds: 28_800,
    });

    expect(engine.rejects({ kind: 'rescue_teams_deployed', t: 1, count: 3 })).toMatch(/not supported/i);
  });

  it('drains incremental updates without cloning the full run summary', () => {
    const scenario = mockScenario() as Scenario;
    const engine = new CoreEngine(scenario, 5, {
      dispatchMode: 'negotiation',
      npcParams: DEFAULT_NPC_PARAMS,
      maxTicks: 20,
      startTimeSeconds: 28_800,
    });
    const simulation = (engine as unknown as { sim: ReturnType<typeof createSimulation> }).sim;
    const incremental = vi.spyOn(simulation, 'updatesSince');
    const summary = vi.spyOn(simulation, 'summary');

    const initial = engine.drain();
    engine.step();
    const next = engine.drain();

    expect(incremental).toHaveBeenNthCalledWith(1, 0, 0);
    expect(incremental).toHaveBeenNthCalledWith(2, expect.any(Number), expect.any(Number));
    expect(initial.events.length + next.events.length).toBeGreaterThan(0);
    expect(summary).not.toHaveBeenCalled();
  });
});
