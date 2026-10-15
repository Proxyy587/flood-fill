import { z } from 'zod';

export const SeveritySchema = z.enum(['low', 'medium', 'high']);
export type Severity = z.infer<typeof SeveritySchema>;

export const EvidenceSchema = z
  .object({
    eventTicks: z.array(z.number().int().nonnegative()).max(40).optional(),
    cells: z.array(z.number().int().nonnegative()).max(400).optional(),
    metric: z.string().max(80).optional(),
    value: z.number().finite().optional(),
  })
  .strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z
  .object({
    id: z.string().min(1).max(40),
    severity: SeveritySchema,
    title: z.string().min(1).max(140),
    explanation: z.string().min(1).max(900),
    evidence: z.array(EvidenceSchema).max(12),
    confidence: SeveritySchema,
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;

/**
 * Proposal commands are untrusted model output: they are kept loose here and only
 * become a `ScenarioPatch` after `compileProposal` whitelists, bounds and costs them.
 */
export const ProposalSchema = z
  .object({
    id: z.string().min(1).max(40),
    addresses: z.array(z.string().max(40)).max(12),
    title: z.string().min(1).max(140),
    rationale: z.string().min(1).max(900),
    commands: z.array(z.unknown()).max(200),
    expectedEffect: z.string().min(1).max(400),
    cost: z.number().finite().nonnegative(),
  })
  .strict();
export type Proposal = z.infer<typeof ProposalSchema>;

export const CriticReportSchema = z
  .object({
    summary: z.string().min(1).max(1200),
    findings: z.array(FindingSchema).max(12),
    proposals: z.array(ProposalSchema).max(8),
    limitations: z.array(z.string().min(1).max(300)).min(1).max(10),
  })
  .strict();
export type CriticReport = z.infer<typeof CriticReportSchema>;

export type CriticSource = 'llm' | 'fallback' | 'cache';

/** What `/api/critic` returns, always with HTTP 200. */
export interface CriticResponse {
  source: CriticSource;
  report: CriticReport;
  /** Why the fallback was used, in plain words. Never contains secrets. */
  notice?: string;
}

export const LIMITATIONS = [
  'Synthetic city and synthetic people; no real map, population or live feed is used.',
  'Simplified flood, traffic and power physics; magnitudes are indicative, not calibrated.',
  'Simulation output; not an emergency-planning authority.',
  'Proposals are hypotheses until re-simulation verifies them, and even then only inside this model.',
] as const;
