import { CriticReportSchema, type CriticResponse } from '../schema';
import type { Verification } from '../verify';
import reports from './reports.json';

/** A committed critic report plus verification results, keyed by proposal id. */
export interface CachedCritique {
  response: CriticResponse;
  verifications: Record<string, Verification>;
}

const table = reports as unknown as Record<string, CachedCritique>;

/** The pre-generated report for a template city, if one was committed. */
export function cachedCritique(scenarioName: string): CriticResponse | null {
  const hit = table[scenarioName];
  if (!hit) return null;
  const report = CriticReportSchema.safeParse(hit.response.report);
  return report.success ? { ...hit.response, source: 'cache', report: report.data } : null;
}

export function cachedVerification(scenarioName: string, proposalId: string): Verification | null {
  return table[scenarioName]?.verifications[proposalId] ?? null;
}
