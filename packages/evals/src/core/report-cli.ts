import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { pluginOf } from './arms.js';
import { isGraderValidation } from './grader-validate.js';
import type { PlannerEvalPlugin } from './plugin.js';
import { writeReport } from './report.js';
import type { RunRecord } from './run.js';

/**
 * Re-renders the report of a finished run from its `records.json` and the
 * meta in its `summary.json`, with the current plugins' rows. Arms no
 * plugin registers any more keep the runner's rows only and are named.
 */
export async function runReportCli(
  plugins: readonly PlannerEvalPlugin[],
  argv: readonly string[],
): Promise<void> {
  const { values } = parseArgs({
    args: argv.slice(2),
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
  const unclaimed = [...new Set(records.map((record) => record.arm))].filter(
    (arm) => pluginOf(plugins, arm) === undefined,
  );
  if (unclaimed.length > 0)
    console.warn(
      `no plugin registers ${unclaimed.join(', ')}; their rows are the runner's only`,
    );

  await writeReport(out, records, meta, { plugins, graderValidation });
  console.log(`Report re-rendered at ${out}/report.md`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
