import { z } from 'zod';
import { critique, type CriticDeps } from './critic';
import type { EvidencePack } from './evidence';
import { CriticReportSchema, type CriticResponse } from './schema';

export const MAX_BODY_BYTES = 96 * 1024;

const PackSchema = z
  .object({
    legend: z.array(z.string()),
    city: z.object({ name: z.string(), sizeCells: z.tuple([z.number().int().positive(), z.number().int().positive()]) }).passthrough(),
    run: z.object({}).passthrough(),
    findings: z.array(z.object({}).passthrough()).max(20),
    allowedChanges: z.object({}).passthrough(),
    miniMap: z.array(z.string().max(200)).max(200).optional(),
  })
  .passthrough();

export const CriticRequestSchema = z.object({ pack: PackSchema, fallback: CriticReportSchema }).strict();

/** Fixed-window limiter per client key. In-memory: one dev server or one serverless instance. */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = () => Date.now()) {
  const hits = new Map<string, { start: number; count: number }>();
  return (key: string): boolean => {
    const t = now();
    const h = hits.get(key);
    if (!h || t - h.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      if (hits.size > 1000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      return true;
    }
    h.count++;
    return h.count <= limit;
  };
}

export type CriticHttpResult = { status: number; body: CriticResponse | { error: string } };

/** The whole route, minus the Next.js wrapper, so it can be tested without a server. */
export async function handleCriticRequest(rawBody: string, client: string, allow: (key: string) => boolean, deps: CriticDeps): Promise<CriticHttpResult> {
  if (rawBody.length > MAX_BODY_BYTES) return { status: 413, body: { error: 'The evidence pack is too large.' } };
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'Send JSON: { pack, fallback }.' } };
  }
  const parsed = CriticRequestSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: `Invalid critic request: ${parsed.error.issues[0]?.path.join('.') || 'body'} ${parsed.error.issues[0]?.message ?? ''}`.trim() } };
  const { pack, fallback } = parsed.data;
  if (!allow(client)) return { status: 200, body: { source: 'fallback', report: fallback, notice: 'Too many critic requests in the last minute, so this report comes from the rule-based analysers.' } };
  return { status: 200, body: await critique(pack as unknown as EvidencePack, fallback, deps) };
}
