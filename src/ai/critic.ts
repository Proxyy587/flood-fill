import { CriticReportSchema, type CriticReport, type CriticResponse } from './schema';
import type { EvidencePack } from './evidence';

/** OpenRouter OpenAI-compatible chat completions. */
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** Non-Anthropic default; override with `OPENROUTER_MODEL`. */
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

/** @deprecated Use OPENROUTER_URL — kept so older imports keep compiling. */
export const ANTHROPIC_URL = OPENROUTER_URL;

export const SYSTEM_PROMPT = [
  'You are an emergency-planning simulation analyst reviewing one run of a synthetic flood simulation.',
  'Goal: propose city changes that raise the city resilience score in run.score, starting with its weakest parts. Use floodRules to pick levers that actually work in this model.',
  'Rules:',
  '- Cite evidence: every finding must reference finding ids, cells or ticks that appear in the evidence pack.',
  '- Never invent metrics that are not in the pack. Say when evidence is insufficient and lower your confidence.',
  '- Never claim real-world authority. This is a simulation, not emergency-planning advice.',
  '- Prefer small, cheap changes first. Stay within the budget and the allowed changes listed in the pack.',
  '- Proposal commands must be JSON objects of exactly these shapes:',
  '  {"kind":"setBlock","cell":<int>,"block":<allowed block id>}',
  '  {"kind":"paintRect","x0":<int>,"z0":<int>,"x1":<int>,"z1":<int>,"block":<allowed block id>} (at most 12x12)',
  '  {"kind":"placeBuilding","def":{"type":<helipad id>,"cells":[<up to 4 adjacent cells>],"entrance":<one of the cells>}}',
  '- expectedEffect is a hypothesis to be verified by re-simulation, not a promise.',
  'Reply with JSON only, matching:',
  '{"summary":string (<=120 words),"findings":[{"id","severity":"low|medium|high","title","explanation","evidence":[{"eventTicks"?:int[],"cells"?:int[],"metric"?:string,"value"?:number}],"confidence":"low|medium|high"}],',
  '"proposals":[{"id","addresses":[finding ids],"title","rationale","commands":[...],"expectedEffect","cost":number}],"limitations":[string, at least one]}',
].join('\n');

export interface CriticDeps {
  apiKey?: string;
  model?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

/** Pulls the first JSON object out of a model reply, tolerating code fences. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The reply contained no JSON object.');
  return JSON.parse(body.slice(start, end + 1));
}

const issuesOf = (e: unknown) =>
  e instanceof Error && 'issues' in e && Array.isArray((e as { issues: unknown[] }).issues)
    ? (e as { issues: { path: PropertyKey[]; message: string }[] }).issues.slice(0, 6).map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ')
    : e instanceof Error
      ? e.message
      : 'invalid output';

/** Drops evidence cells outside the grid so a confused model cannot highlight off-map cells. */
function sanitise(report: CriticReport, pack: EvidencePack): CriticReport {
  const n = pack.city.sizeCells[0] * pack.city.sizeCells[1];
  for (const f of report.findings) for (const ev of f.evidence) if (ev.cells) ev.cells = ev.cells.filter((c) => c < n);
  return report;
}

/**
 * Asks the model for a critique; validates it, retries once with the validation error,
 * and otherwise returns the analyser-built fallback. Never throws, never logs the key.
 */
export async function critique(pack: EvidencePack, fallback: CriticReport, deps: CriticDeps = {}): Promise<CriticResponse> {
  const doFetch = deps.fetch ?? fetch;
  if (!deps.apiKey) return { source: 'fallback', report: fallback, notice: 'No API key is configured, so this report comes from the rule-based analysers.' };
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Evidence pack:\n${JSON.stringify(pack)}` },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = await callModel(doFetch, deps, messages);
    } catch (e) {
      return { source: 'fallback', report: fallback, notice: e instanceof CriticHttpError ? e.message : 'The critic service could not be reached, so this report comes from the rule-based analysers.' };
    }
    try {
      return { source: 'llm', report: sanitise(CriticReportSchema.parse(extractJson(text)), pack) };
    } catch (e) {
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `Your reply failed validation: ${issuesOf(e)}. Reply again with corrected JSON only.` });
    }
  }
  return { source: 'fallback', report: fallback, notice: 'The critic replied with invalid output twice, so this report comes from the rule-based analysers.' };
}

class CriticHttpError extends Error {}

async function callModel(doFetch: typeof fetch, deps: CriticDeps, messages: Message[]): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 45_000);
  try {
    const res = await doFetch(OPENROUTER_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${deps.apiKey ?? ''}`,
        'http-referer': 'https://floodsim.local',
        'x-title': 'FloodSim critic',
      },
      body: JSON.stringify({
        model: deps.model ?? DEFAULT_MODEL,
        max_tokens: 4000,
        temperature: 0.2,
        messages,
      }),
    });
    if (res.status === 401 || res.status === 403) throw new CriticHttpError('The critic service rejected the configured API key, so this report comes from the rule-based analysers.');
    if (res.status === 429) throw new CriticHttpError('The critic service is rate-limited right now, so this report comes from the rule-based analysers.');
    if (!res.ok) throw new CriticHttpError(`The critic service returned HTTP ${res.status}, so this report comes from the rule-based analysers.`);
    const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new CriticHttpError('The critic service returned an empty reply, so this report comes from the rule-based analysers.');
    return content;
  } finally {
    clearTimeout(timer);
  }
}
