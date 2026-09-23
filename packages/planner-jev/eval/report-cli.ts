import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { isGraderValidation } from './grader-validate.js';
import { writeReport } from './report.js';
import type { RunRecord } from './run.js';
import { scenarios } from './scenarios.js';

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
  },
});

const from = values.from;
if (from === undefined) fail('--from <out dir> is required');
const out = resolve(from);

const records = JSON.parse(
  await readFile(join(out, 'records.json'), 'utf8'),
) as readonly RunRecord[];
const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8'));
const meta = (summary?.meta ?? {}) as Readonly<Record<string, unknown>>;
const graderValidation = isGraderValidation(summary?.graderValidation)
  ? summary.graderValidation
  : undefined;

await writeReport(out, records, meta, graderValidation, scenarios);
console.log(`Report re-rendered at ${out}/report.md`);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
