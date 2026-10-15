'use client';

import type { MetricComparison, Verdict, Verification } from '../../ai/verify';
import styles from './report.module.css';

export const VERDICT_TEXT: Record<Verdict, string> = {
  improved: 'Verified improvement',
  worse: 'Worse',
  no_clear_effect: 'No clear effect',
};

const fmt = (v: number, unit: string) => `${Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;

/** Paired-seed spread of the change, centred on zero. */
function SpreadBar({ m }: { m: MetricComparison }) {
  const scale = Math.max(Math.abs(m.delta.min), Math.abs(m.delta.max), 1e-6);
  const left = 50 + (m.delta.min / scale) * 48;
  const right = 50 + (m.delta.max / scale) * 48;
  return (
    <div className={styles.spread} title={`Change per seed: ${fmt(m.delta.min, m.unit)} to ${fmt(m.delta.max, m.unit)}`}>
      <span data-verdict={m.verdict} style={{ left: `${left}%`, width: `${Math.max(2, right - left)}%` }} />
    </div>
  );
}

const list = (ms: MetricComparison[]) => ms.map((m) => m.label.toLowerCase()).join(', ');

function patchVerdict(result: Verification, better: MetricComparison[], worse: MetricComparison[]): string {
  if (result.verdict === 'improved') return `${VERDICT_TEXT.improved} in ${list(better)}${better.length < result.metrics.length ? '; no clear effect on the rest' : ''}.`;
  if (result.verdict === 'worse') return `${VERDICT_TEXT.worse}: ${list(worse)} got worse on every seed${better.length ? `, even though ${list(better)} improved` : ''}.`;
  return `${VERDICT_TEXT.no_clear_effect}: the change across seeds overlaps zero for every measure.`;
}

/** Banner for two policies, where neither side is "the change": name who did better on what. */
function policyVerdict(subject: string, other: string, better: MetricComparison[], worse: MetricComparison[]): string {
  if (!better.length && !worse.length) return `No clear difference between "${other}" and "${subject}" on any measure.`;
  const parts = [better.length ? `better on ${list(better)}` : '', worse.length ? `worse on ${list(worse)}` : ''].filter(Boolean);
  return `"${subject}" did ${parts.join(' but ')} on every seed; no clear difference on the rest.`;
}

/** Two variants side by side: means, change, spread across seeds, and a verdict that never hides "worse". */
export function Comparison({ result, before, after, policies = false }: { result: Verification; before: string; after: string; policies?: boolean }) {
  const worse = result.metrics.filter((m) => m.verdict === 'worse');
  const better = result.metrics.filter((m) => m.verdict === 'improved');
  return (
    <div className={styles.bars}>
      <div className={styles.verdict} data-verdict={policies ? 'no_clear_effect' : result.verdict} role="status">
        {policies ? policyVerdict(after, before, better, worse) : patchVerdict(result, better, worse)}
      </div>
      <div className={styles.scroll} style={{ maxHeight: 'none' }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Measure</th>
              <th>{before}</th>
              <th>{after}</th>
              <th>Change</th>
              <th>Spread</th>
            </tr>
          </thead>
          <tbody>
            {result.metrics.map((m) => (
              <tr key={m.key}>
                <td>{m.label}</td>
                <td>{fmt(m.baseline.mean, m.unit)}</td>
                <td>{fmt(m.patched.mean, m.unit)}</td>
                <td className={styles.delta} data-verdict={m.verdict}>
                  {m.delta.mean > 0 ? '+' : ''}
                  {fmt(m.delta.mean, m.unit)}
                </td>
                <td>
                  <SpreadBar m={m} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted}>
        {result.seeds.length} seeds ({result.seeds.join(', ')}), {Math.round(result.ticks / 60)} simulated minutes each, {result.engine === 'core' ? 'core simulator' : 'preview model'}. A change counts only when every seed agrees.
      </p>
    </div>
  );
}
