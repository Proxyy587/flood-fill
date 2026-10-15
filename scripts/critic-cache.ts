/**
 * Pre-generates an offline critic report and one verification per template, so the demo
 * never depends on the network. Run with `pnpm critic:cache`; commits src/ai/cache/reports.json.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_NPC_PARAMS, DEFAULT_START_SECONDS, type Scenario } from '../src/contracts';
import { mockScenario } from '../src/contracts/mocks';
import { prepareCritique } from '../src/ai';
import type { CachedCritique } from '../src/ai/cache';
import { compileProposal } from '../src/ai/patchCompiler';
import { runOnce, verifyPatch, type VerifyOptions } from '../src/ai/verify';
import { parseManifest, parseTemplate } from '../src/worker/templates';

const RUN_TICKS = 1800;
const VERIFY_TICKS = 900;

async function main() {
  const root = path.join(process.cwd(), 'scenarios');
  const entries = parseManifest(JSON.parse(await readFile(path.join(root, 'index.json'), 'utf8')));
  const cities: Scenario[] = [mockScenario()];
  for (const e of entries) cities.push(parseTemplate(JSON.parse(await readFile(path.join(root, e.file), 'utf8'))));

  const out: Record<string, CachedCritique> = {};
  for (const scenario of cities) {
    const seed = scenario.defaults.seed;
    const base: VerifyOptions = { seeds: [seed], engine: 'preview', ticks: RUN_TICKS, dispatchMode: scenario.defaults.dispatchMode, npcParams: DEFAULT_NPC_PARAMS, startTimeSeconds: DEFAULT_START_SECONDS };
    const t0 = performance.now();
    const run = runOnce(scenario, seed, base);
    const c = prepareCritique(run, scenario);
    const verifications: CachedCritique['verifications'] = {};
    const first = c.fallback.proposals.map((p) => ({ p, r: compileProposal(p, scenario) })).find((x) => x.r.ok);
    if (first?.r.ok) verifications[first.p.id] = verifyPatch(scenario, first.r.patch, { ...base, seeds: [seed, seed + 1], ticks: VERIFY_TICKS });
    out[scenario.name] = {
      response: {
        source: 'cache',
        report: c.fallback,
        notice: `Pre-generated offline by the rule-based analysers on the preview model (seed ${seed}, ${RUN_TICKS / 60} simulated minutes from 08:00). Run the storm and critique it for a report on your own run.`,
      },
      verifications,
    };
    console.log(`${scenario.name}: ${c.analyses.length} analyses, ${c.fallback.proposals.length} proposals, ${Object.keys(verifications).length} verified (${Math.round(performance.now() - t0)} ms)`);
  }
  const file = path.join(process.cwd(), 'src/ai/cache/reports.json');
  await writeFile(file, JSON.stringify(out, null, 1) + '\n');
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

void main();
