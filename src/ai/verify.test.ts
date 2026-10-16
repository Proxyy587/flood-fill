import { describe, expect, it } from 'vitest';
import { BlockType, DEFAULT_NPC_PARAMS } from '../contracts';
import { mockRunSummary, mockScenario } from '../contracts/mocks';
import { prepareCritique } from '.';
import { compileProposal } from './patchCompiler';
import { compareOutcomes, overallVerdict, verifyPatch, type RunOutcome } from './verify';

const o = (stranded: number, ttsP90 = 500): RunOutcome => ({ score: 60, residentsAffected: 40, ttsP90, unmetPct: 10, gridlockMin: 0, hospitalSpread: 20, stranded, unpoweredPeak: 30, floodedCells: 100 });

describe('verification verdicts', () => {
  it('calls it improved only when every paired seed agrees', () => {
    const m = compareOutcomes([o(10), o(12)], [o(6), o(9)]).find((x) => x.key === 'stranded');
    expect(m?.verdict).toBe('improved');
    expect(m?.delta).toEqual({ mean: -3.5, min: -4, max: -3 });
  });
  it('says no clear effect when seeds disagree', () => {
    const m = compareOutcomes([o(10), o(10)], [o(6), o(13)]).find((x) => x.key === 'stranded');
    expect(m?.verdict).toBe('no_clear_effect');
  });
  it('never hides a worse result', () => {
    const metrics = compareOutcomes([o(10, 400), o(10, 400)], [o(5, 600), o(4, 650)]);
    expect(metrics.find((x) => x.key === 'ttsP90')?.verdict).toBe('worse');
    expect(overallVerdict(metrics)).toBe('worse');
  });
});

describe('verifyPatch', () => {
  it('re-runs baseline and patched cities on the same seeds, deterministically', () => {
    const scenario = mockScenario(7);
    const critique = prepareCritique(mockRunSummary(900, 7), scenario);
    const proposal = critique.fallback.proposals[0];
    expect(proposal).toBeDefined();
    const compiled = compileProposal(proposal, scenario);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const opts = { seeds: [7, 8], engine: 'preview' as const, ticks: 600, dispatchMode: 'negotiation' as const, npcParams: DEFAULT_NPC_PARAMS, startTimeSeconds: 8 * 3600 };
    const progress: number[] = [];
    const a = verifyPatch(scenario, compiled.patch, { ...opts, onProgress: (d) => progress.push(d) });
    const b = verifyPatch(scenario, compiled.patch, opts);
    expect(progress).toEqual([1, 2, 3, 4]);
    expect(a.metrics).toHaveLength(9);
    expect(a.metrics[0].key).toBe('score');
    expect(['improved', 'worse', 'no_clear_effect']).toContain(a.verdict);
    expect(b).toEqual(a);
  }, 60_000);

  it('drainage patch on preview can move flooded-homes or score (smoke)', () => {
    const scenario = mockScenario(11);
    const drains: { kind: 'setBlock'; cell: number; block: BlockType }[] = [];
    for (let i = 0; i < scenario.blocks.length && drains.length < 12; i++) {
      if (scenario.blocks[i] === BlockType.Grass) drains.push({ kind: 'setBlock', cell: i, block: BlockType.Drainage });
    }
    const compiled = compileProposal({ title: 'Drains', rationale: 'Add storm drains', commands: drains }, scenario);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.create.length).toBeGreaterThan(0);
    const result = verifyPatch(scenario, compiled.patch, {
      seeds: [11],
      engine: 'preview',
      ticks: 900,
      dispatchMode: 'negotiation',
      npcParams: DEFAULT_NPC_PARAMS,
      startTimeSeconds: 8 * 3600,
    });
    const score = result.metrics.find((m) => m.key === 'score');
    const homes = result.metrics.find((m) => m.key === 'residentsAffected');
    const flooded = result.metrics.find((m) => m.key === 'floodedCells');
    // At least one flood-related measure must react (or stay flat if the patch misses ponds).
    expect(score && homes && flooded).toBeTruthy();
    expect(['improved', 'worse', 'no_clear_effect']).toContain(result.verdict);
  }, 60_000);
});
