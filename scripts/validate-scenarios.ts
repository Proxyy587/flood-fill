// Zod-validates every scenarios/*.json. Skeleton from M0; Worker 1 owns it from here.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScenarioSchema } from '../src/contracts/schemas';

const dir = join(import.meta.dirname, '..', 'scenarios');
let files: string[] = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');
} catch {
  console.log('validate: no scenarios/ directory yet, nothing to check');
  process.exit(0);
}

let failed = 0;
for (const f of files) {
  const result = ScenarioSchema.safeParse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
  if (result.success) {
    console.log(`ok    ${f}`);
  } else {
    failed++;
    console.log(`FAIL  ${f}`);
    for (const issue of result.error.issues.slice(0, 10)) console.log(`      ${issue.path.join('.')}: ${issue.message}`);
  }
}
console.log(`validate: ${files.length - failed}/${files.length} scenarios valid`);
process.exit(failed ? 1 : 0);
