import type { RunSummary, Scenario } from '../../contracts';
import type { Analysis } from '../../ai/analysers';
import type { Incident } from '../replay/afterAction';

export interface DistrictWait {
  name: string;
  /** Mean seconds from request to help, over served requests. */
  mean: number;
  served: number;
  unmet: number;
}

/** Time to service per district, for the fairness view. */
export function districtWaits(run: Pick<RunSummary, 'events'>, scenario: Scenario): DistrictWait[] {
  const district = new Int16Array(scenario.size.w * scenario.size.h).fill(-1);
  scenario.districts.forEach((d, i) => d.cells.forEach((c) => (district[c] = i)));
  const created = new Map<number, { tick: number; d: number }>();
  for (const e of run.events) if (e.type === 'REQUEST_CREATED' && e.target !== undefined) created.set(e.target, { tick: e.tick, d: e.cell === undefined ? -1 : district[e.cell] });
  const rows = scenario.districts.map((d) => ({ name: d.name, total: 0, served: 0, unmet: 0 }));
  const done = new Set<number>();
  for (const e of run.events) {
    if (e.type !== 'SERVED' || e.target === undefined) continue;
    const req = created.get(e.target);
    if (!req || req.d < 0 || done.has(e.target)) continue;
    done.add(e.target);
    rows[req.d].total += typeof e.data?.tts === 'number' ? e.data.tts : e.tick - req.tick;
    rows[req.d].served++;
  }
  for (const [id, req] of created) if (req.d >= 0 && !done.has(id)) rows[req.d].unmet++;
  return rows.filter((r) => r.served || r.unmet).map((r) => ({ name: r.name, mean: r.served ? r.total / r.served : 0, served: r.served, unmet: r.unmet }));
}

const mins = (s: number) => `${(s / 60).toFixed(1)} min`;

/** A one-page Markdown after-action report. Deterministic; no language model. */
export function runReportMarkdown(o: { run: RunSummary; scenario: Scenario; analyses: readonly Analysis[]; incidents: readonly Incident[]; clock: (tick: number) => string }): string {
  const last = o.run.metrics.at(-1);
  const lines = [
    `# FloodSim run report: ${o.scenario.name}`,
    '',
    `Seed ${o.run.seed} · ${o.run.mode === 'negotiation' ? 'units negotiate' : 'HQ assigns'} · ${Math.round((last?.tick ?? 0) / 60)} simulated minutes`,
    '',
    '> Simulation output; not an emergency-planning authority. Synthetic city and people. 1 cell = 4 m.',
    '',
    '## Outcome',
    '',
    '| Measure | Value |',
    '|---|---|',
  ];
  if (last) {
    lines.push(
      `| Time to help (mean / p50 / p90) | ${mins(last.tts.mean)} / ${mins(last.tts.p50)} / ${mins(last.tts.p90)} |`,
      `| Calls never answered | ${last.unmet} |`,
      `| People stranded at the end | ${last.stranded} |`,
      `| Evacuation complete | ${Math.round(last.evacDonePct)}% |`,
      `| Peak residents without power | ${Math.round(o.run.metrics.reduce((m, f) => Math.max(m, f.unpoweredPopPct), 0))}% |`,
      `| Helicopter rescues | ${last.heliRescues} |`,
      `| Fairness (Gini of waits) | ${last.gini.toFixed(2)} |`,
      `| Route violations (must be 0) | ${last.routeViolations} |`,
    );
  }
  lines.push('', '## Top incidents', '');
  o.incidents.forEach((i, n) => lines.push(`${n + 1}. **${o.clock(i.tick)} ${i.title}.** ${i.detail}`));
  if (!o.incidents.length) lines.push('No major incidents.');
  lines.push('', '## Findings (rule-based analysers)', '');
  for (const f of o.analyses.flatMap((a) => a.findings)) lines.push(`- **${f.title}** (${f.severity}, confidence ${f.confidence}). ${f.explanation}`);
  if (!o.analyses.length) lines.push('No findings.');
  const fairness = districtWaits(o.run, o.scenario);
  if (fairness.length) {
    lines.push('', '## Waits by district', '', '| District | Mean wait | Served | Unanswered |', '|---|---|---|---|');
    for (const d of fairness) lines.push(`| ${d.name} | ${mins(d.mean)} | ${d.served} | ${d.unmet} |`);
  }
  return lines.join('\n') + '\n';
}
