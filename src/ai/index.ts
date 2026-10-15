import type { RunSummary, Scenario } from '../contracts';
import { analyseRun, type Analysis } from './analysers';
import { cityIndex, type CityIndex } from './cityIndex';
import { buildEvidencePack, type EvidencePack } from './evidence';
import { fallbackReport } from './fallback';
import type { CriticReport, CriticResponse } from './schema';

export { analyseRun, cityIndex, buildEvidencePack, fallbackReport };
export type { Analysis, CityIndex, EvidencePack, CriticReport, CriticResponse };

export interface Critique {
  analyses: Analysis[];
  pack: EvidencePack;
  fallback: CriticReport;
}

/** Everything the critic needs that can be computed locally, deterministically, with no network. */
export function prepareCritique(run: RunSummary, scenario: Scenario): Critique {
  const city = cityIndex(scenario);
  const analyses = analyseRun(run, city);
  return { analyses, pack: buildEvidencePack(run, city, analyses), fallback: fallbackReport(analyses, city) };
}

/** Asks `/api/critic`; if the network is down the analyser report is returned instead. */
export async function requestCritique(c: Critique, doFetch: typeof fetch = fetch): Promise<CriticResponse> {
  try {
    const res = await doFetch('/api/critic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pack: c.pack, fallback: c.fallback }) });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as CriticResponse;
  } catch {
    return { source: 'fallback', report: c.fallback, notice: 'The critic route is unreachable (offline?), so this report comes from the rule-based analysers.' };
  }
}
