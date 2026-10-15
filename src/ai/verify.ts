import type { DispatchMode, NpcParams, RunSummary, Scenario, ScenarioPatch, SimEngine } from '../contracts';
import { applyCommands } from '../editor/commands';
import { createEngine } from '../worker/engines';
import { scoreRun } from './score';

export type Verdict = 'improved' | 'worse' | 'no_clear_effect';

export interface RunOutcome {
  score: number;
  ttsP90: number;
  unmetPct: number;
  gridlockMin: number;
  hospitalSpread: number;
  stranded: number;
  residentsAffected: number;
  unpoweredPeak: number;
  floodedCells: number;
}

export const OUTCOME_METRICS: { key: keyof RunOutcome; label: string; unit: string; better: 'lower' | 'higher' }[] = [
  { key: 'score', label: 'City resilience score', unit: 'pts', better: 'higher' },
  { key: 'residentsAffected', label: 'Residents whose homes flooded', unit: '', better: 'lower' },
  { key: 'ttsP90', label: 'Slowest 10% wait for help', unit: 's', better: 'lower' },
  { key: 'unmetPct', label: 'Calls never answered', unit: '%', better: 'lower' },
  { key: 'stranded', label: 'People stranded at the end', unit: '', better: 'lower' },
  { key: 'gridlockMin', label: 'Minutes with gridlock', unit: 'min', better: 'lower' },
  { key: 'hospitalSpread', label: 'Hospital load imbalance', unit: 'pts', better: 'lower' },
  { key: 'unpoweredPeak', label: 'Peak residents without power', unit: '%', better: 'lower' },
  { key: 'floodedCells', label: 'Flooded cells at the end', unit: 'cells', better: 'lower' },
];

export interface Spread {
  mean: number;
  min: number;
  max: number;
}

export interface MetricComparison {
  key: keyof RunOutcome;
  label: string;
  unit: string;
  better: 'lower' | 'higher';
  baseline: Spread;
  patched: Spread;
  /** Paired per-seed difference, patched − baseline. */
  delta: Spread;
  verdict: Verdict;
}

export interface Verification {
  engine: SimEngine;
  seeds: number[];
  ticks: number;
  metrics: MetricComparison[];
  verdict: Verdict;
}

export interface VerifyOptions {
  seeds: number[];
  engine: SimEngine;
  ticks: number;
  dispatchMode: DispatchMode;
  npcParams: NpcParams;
  startTimeSeconds: number;
  onProgress?: (done: number, total: number) => void;
}

export function outcomeOf(run: RunSummary, scenario: Pick<Scenario, 'population' | 'buildings'>): RunOutcome {
  const last = run.metrics.at(-1);
  const dt = run.metrics.length > 1 ? run.metrics[1].tick - run.metrics[0].tick : 1;
  const requests = run.events.filter((e) => e.type === 'REQUEST_CREATED').length;
  const peaks = new Map<number, number>();
  for (const f of run.metrics) for (const x of f.hospitals) peaks.set(x.id, Math.max(peaks.get(x.id) ?? 0, x.util));
  const utils = [...peaks.values()];
  return {
    score: scoreRun(run, scenario).total,
    residentsAffected: last?.residentsAffected ?? 0,
    ttsP90: last?.tts.p90 ?? 0,
    unmetPct: requests ? ((last?.unmet ?? 0) / requests) * 100 : 0,
    gridlockMin: (run.metrics.filter((m) => m.gridlockCells > 0).length * dt) / 60,
    hospitalSpread: utils.length > 1 ? (Math.max(...utils) - Math.min(...utils)) * 100 : 0,
    stranded: last?.stranded ?? 0,
    unpoweredPeak: run.metrics.reduce((m, f) => Math.max(m, f.unpoweredPopPct), 0),
    floodedCells: last?.floodedCells ?? 0,
  };
}

const spread = (xs: number[]): Spread => ({ mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length), min: Math.min(...xs), max: Math.max(...xs) });

/** Improvement only when every paired seed agrees and the mean moves by more than noise. */
export function compareOutcomes(base: RunOutcome[], patched: RunOutcome[]): MetricComparison[] {
  return OUTCOME_METRICS.map((m) => {
    const b = base.map((o) => o[m.key]);
    const p = patched.map((o) => o[m.key]);
    const d = p.map((v, i) => v - b[i]);
    const gain = d.map((v) => (m.better === 'lower' ? -v : v));
    const tol = Math.max(1e-6, Math.abs(spread(b).mean) * 0.01);
    const meanGain = gain.reduce((a, v) => a + v, 0) / Math.max(1, gain.length);
    const verdict: Verdict = meanGain > tol && gain.every((g) => g >= 0) ? 'improved' : meanGain < -tol && gain.every((g) => g <= 0) ? 'worse' : 'no_clear_effect';
    return { ...m, baseline: spread(b), patched: spread(p), delta: spread(d), verdict };
  });
}

export function overallVerdict(metrics: readonly MetricComparison[]): Verdict {
  if (metrics.some((m) => m.verdict === 'worse')) return 'worse';
  return metrics.some((m) => m.verdict === 'improved') ? 'improved' : 'no_clear_effect';
}

export function runOnce(scenario: Scenario, seed: number, o: VerifyOptions): RunSummary {
  const engine = createEngine(o.engine, scenario, seed, { dispatchMode: o.dispatchMode, npcParams: o.npcParams, maxTicks: o.ticks, startTimeSeconds: o.startTimeSeconds });
  while (engine.tick < o.ticks) engine.step();
  return engine.summary();
}

/** Runs two variants on the same seeds and compares them pairwise. */
function compareVariants(a: { scenario: Scenario; o: VerifyOptions }, b: { scenario: Scenario; o: VerifyOptions }, o: VerifyOptions): Verification {
  const total = o.seeds.length * 2;
  const base: RunOutcome[] = [];
  const after: RunOutcome[] = [];
  o.seeds.forEach((seed, i) => {
    base.push(outcomeOf(runOnce(a.scenario, seed, a.o), a.scenario));
    o.onProgress?.(i * 2 + 1, total);
    after.push(outcomeOf(runOnce(b.scenario, seed, b.o), b.scenario));
    o.onProgress?.(i * 2 + 2, total);
  });
  const metrics = compareOutcomes(base, after);
  return { engine: o.engine, seeds: o.seeds, ticks: o.ticks, metrics, verdict: overallVerdict(metrics) };
}

/** Re-simulates baseline and patched cities on the same seeds. Pure and deterministic; run it off the main thread. */
export function verifyPatch(scenario: Scenario, patch: ScenarioPatch, o: VerifyOptions): Verification {
  return compareVariants({ scenario, o }, { scenario: applyCommands(scenario, patch.commands), o }, o);
}

/** Negotiation (baseline) against the centralised dispatcher, same city and seeds. */
export function compareDispatch(scenario: Scenario, o: VerifyOptions): Verification {
  return compareVariants({ scenario, o: { ...o, dispatchMode: 'negotiation' } }, { scenario, o: { ...o, dispatchMode: 'centralised' } }, o);
}
