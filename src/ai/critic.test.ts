import { describe, expect, it, vi } from 'vitest';
import { BlockType } from '../contracts';
import { applyCommands } from '../editor/commands';
import { analyseRun } from './analysers';
import { cityIndex } from './cityIndex';
import { critique, extractJson } from './critic';
import { createRateLimiter, handleCriticRequest } from './criticRoute';
import { buildEvidencePack, estimateTokens, TOKEN_BUDGET } from './evidence';
import { fallbackReport } from './fallback';
import { at, fixtureCity, fixtureRun } from './fixtures';
import { compileProposal, DEFAULT_BUDGET } from './patchCompiler';
import { CriticReportSchema, type CriticReport } from './schema';

const scenario = fixtureCity();
const city = cityIndex(scenario);
const analyses = analyseRun(fixtureRun(), city);
const pack = buildEvidencePack(fixtureRun(), city, analyses);
const fallback = fallbackReport(analyses, city);

const llmReport: CriticReport = {
  summary: 'Eastfield was cut off.',
  findings: [{ id: 'f1', severity: 'high', title: 'Cut off', explanation: 'Junction closed.', evidence: [{ cells: [at(12, 10), 99999] }], confidence: 'medium' }],
  proposals: [],
  limitations: ['Synthetic.'],
};
const reply = (text: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status });

describe('evidence pack', () => {
  it('names places instead of dumping the grid, and fits the token budget', () => {
    const text = JSON.stringify(pack);
    expect(estimateTokens(text)).toBeLessThanOrEqual(TOKEN_BUDGET);
    expect(text).toContain('Eastfield');
    expect(text).not.toMatch(/\[(\d+,){100}/);
    expect(pack.miniMap?.length).toBe(24);
  });
  it('trims detail to honour a tight budget', () => {
    const tight = buildEvidencePack(fixtureRun(), city, analyses, { tokenBudget: 900 });
    expect(tight.miniMap).toBeUndefined();
    expect(tight.findings.length).toBeLessThanOrEqual(pack.findings.length);
  });
});

describe('fallback report', () => {
  it('is a valid report with executable, in-budget proposals', () => {
    expect(() => CriticReportSchema.parse(fallback)).not.toThrow();
    expect(fallback.limitations.length).toBeGreaterThan(0);
    expect(fallback.proposals.map((p) => p.id)).toEqual(expect.arrayContaining(['add-drains', 'substation-levee']));
    for (const p of fallback.proposals) {
      const r = compileProposal(p, scenario);
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) expect(() => applyCommands(scenario, r.patch.commands)).not.toThrow();
    }
  });
});

describe('patch compiler', () => {
  const ok = (commands: unknown[]) => compileProposal({ title: 't', rationale: 'r', commands }, scenario);
  it('accepts whitelisted blocks and costs them', () => {
    const r = ok([{ kind: 'setBlock', cell: at(4, 18), block: BlockType.Drainage }, { kind: 'paintRect', x0: 0, z0: 15, x1: 2, z1: 15, block: BlockType.Levee }]);
    expect(r.ok && r.patch.estimatedCost).toBe(2 + 3 * 2);
  });
  it('rejects hostile input', () => {
    const cases: unknown[][] = [
      [{ kind: 'setBlock', cell: at(4, 18), block: BlockType.Hospital }],
      [{ kind: 'removeAt', cell: at(2, 8) }],
      [{ kind: 'setHeight', cell: 0, ground: 99 }],
      [{ kind: 'setBlock', cell: 24 * 24, block: BlockType.Road }],
      [{ kind: 'setBlock', cell: -1, block: BlockType.Road }],
      [{ kind: 'setBlock', cell: 1.5, block: BlockType.Road }],
      [{ kind: 'setBlock', cell: at(2, 8), block: BlockType.Road }],
      [{ kind: 'setBlock', cell: at(4, 18), block: BlockType.Bridge }],
      [{ kind: 'paintRect', x0: 0, z0: 0, x1: 20, z1: 20, block: BlockType.Road }],
      [{ kind: 'applyPatch', patch: { title: 'x', rationale: 'y', commands: [], estimatedCost: 0 } }],
      [{ kind: 'setBlock', cell: 5, block: BlockType.Road, __proto__: { admin: true }, extra: 1 }],
      [{ kind: 'placeBuilding', def: { type: BlockType.Hospital, cells: [at(4, 18)], entrance: at(4, 18) } }],
      [{ kind: 'placeBuilding', def: { type: BlockType.Helipad, cells: [at(4, 18), at(9, 18)], entrance: at(4, 18) } }],
      ['setBlock 5 road'],
      [],
    ];
    for (const c of cases) expect(ok(c).ok, JSON.stringify(c)).toBe(false);
  });
  it('caps cost at the budget and clamps rectangles to the grid', () => {
    const levees = Array.from({ length: 24 }, (_, x) => ({ kind: 'setBlock', cell: at(x, 20), block: BlockType.Bridge }));
    expect(ok(levees).ok).toBe(false);
    const big = compileProposal({ title: 't', rationale: 'r', commands: Array.from({ length: 11 }, (_, z) => ({ kind: 'paintRect', x0: 13, z0: z, x1: 23, z1: z, block: BlockType.Road })) }, scenario, DEFAULT_BUDGET);
    expect(big.ok).toBe(true);
    const edge = ok([{ kind: 'paintRect', x0: 20, z0: 20, x1: 30, z1: 21, block: BlockType.Levee }]);
    expect(edge.ok && edge.clamped).toBe(true);
    expect(edge.ok && edge.cells.every((c) => c < 24 * 24)).toBe(true);
  });
  it('places a compact helipad on free ground', () => {
    const r = ok([{ kind: 'placeBuilding', def: { type: BlockType.Helipad, cells: [at(16, 16), at(17, 16), at(16, 17), at(17, 17)], entrance: at(16, 16) } }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(applyCommands(scenario, r.patch.commands).buildings.at(-1)?.type).toBe(BlockType.Helipad);
  });
});

describe('critic call', () => {
  it('falls back with no key and never calls the network', async () => {
    const f = vi.fn();
    const r = await critique(pack, fallback, { fetch: f });
    expect(r.source).toBe('fallback');
    expect(r.notice).toMatch(/No API key/);
    expect(f).not.toHaveBeenCalled();
  });
  it('accepts a valid reply and drops off-grid evidence cells', async () => {
    const f = vi.fn().mockResolvedValue(reply('```json\n' + JSON.stringify(llmReport) + '\n```'));
    const r = await critique(pack, fallback, { apiKey: 'sk-test', fetch: f });
    expect(r.source).toBe('llm');
    expect(r.report.findings[0].evidence[0].cells).toEqual([at(12, 10)]);
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });
  it('retries once with the validation error, then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(reply('{"summary": 3}')).mockResolvedValueOnce(reply(JSON.stringify(llmReport)));
    const r = await critique(pack, fallback, { apiKey: 'k', fetch: f });
    expect(r.source).toBe('llm');
    const second = JSON.parse((f.mock.calls[1][1] as RequestInit).body as string) as { messages: { role: string; content: string }[] };
    expect(second.messages.at(-1)?.content).toMatch(/failed validation: summary/);
  });
  it('falls back after two invalid replies, on HTTP errors and on network failure, without leaking the key', async () => {
    const twice = await critique(pack, fallback, { apiKey: 'sk-secret', fetch: vi.fn().mockImplementation(async () => reply('not json')) });
    expect(twice).toMatchObject({ source: 'fallback', notice: expect.stringMatching(/invalid output twice/) });
    const denied = await critique(pack, fallback, { apiKey: 'sk-secret', fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 401 })) });
    expect(denied.notice).toMatch(/rejected the configured API key/);
    const down = await critique(pack, fallback, { apiKey: 'sk-secret', fetch: vi.fn().mockRejectedValue(new TypeError('fetch failed')) });
    expect(down.source).toBe('fallback');
    for (const r of [twice, denied, down]) expect(JSON.stringify(r)).not.toContain('sk-secret');
  });
  it('extracts JSON from chatty replies', () => {
    expect(extractJson('Here you go: {"a": 1} hope it helps')).toEqual({ a: 1 });
    expect(() => extractJson('no json')).toThrow();
  });
});

describe('critic route', () => {
  const body = JSON.stringify({ pack, fallback });
  it('validates the request and rate-limits per client', async () => {
    expect((await handleCriticRequest('{', 'a', () => true, {})).status).toBe(400);
    expect((await handleCriticRequest(JSON.stringify({ pack }), 'a', () => true, {})).status).toBe(400);
    expect((await handleCriticRequest('x'.repeat(200_000), 'a', () => true, {})).status).toBe(413);
    const allow = createRateLimiter(1, 60_000, () => 0);
    const first = await handleCriticRequest(body, 'a', allow, {});
    const second = await handleCriticRequest(body, 'a', allow, {});
    expect(first.body).toMatchObject({ source: 'fallback', notice: expect.stringMatching(/No API key/) });
    expect(second.body).toMatchObject({ source: 'fallback', notice: expect.stringMatching(/Too many/) });
    expect((await handleCriticRequest(body, 'b', allow, {})).body).toMatchObject({ notice: expect.stringMatching(/No API key/) });
  });
});
