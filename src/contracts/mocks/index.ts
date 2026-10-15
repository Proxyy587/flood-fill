import type { SimEvent } from '../events';
import type { RunSummary } from '../metrics';
import type { DispatchMode, Scenario } from '../scenario';
import type { RenderSnapshot } from '../snapshot';
import { mockScenario } from './scenario';
import { MockSim } from './sim';

export { createMockRng, type MockRng } from './rng';
export { mockScenario, mockBuildingNames, MOCK_LANDMARKS, MOCK_DISTRICTS } from './scenario';
export { MockSim, MOCK_LIMITS, RAIN_MM_PER_HOUR_AT_FULL, gini, type MockSimOptions } from './sim';

/** Runs the mock sim headless and returns its full summary. */
export const mockRunSummary = (
  ticks = 1800,
  seed = 7,
  dispatchMode: DispatchMode = 'negotiation',
  scenario: Scenario = mockScenario(seed),
): RunSummary => {
  const sim = new MockSim(scenario, seed, { dispatchMode });
  for (let i = 0; i < ticks; i++) sim.step();
  return sim.summary();
};

export const mockEvents = (ticks = 1800, seed = 7): SimEvent[] => mockRunSummary(ticks, seed).events;

/** Yields one snapshot per tick from the mock sim. */
export function* mockSnapshotStream(
  scenario: Scenario = mockScenario(),
  seed = scenario.defaults.seed,
  ticks = Infinity,
): Generator<RenderSnapshot> {
  const sim = new MockSim(scenario, seed);
  for (let i = 0; i < ticks; i++) {
    sim.step();
    yield sim.snapshot();
  }
}
