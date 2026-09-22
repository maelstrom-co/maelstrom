import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';
import { DEFAULT_ARMS, resolveArms } from './arms.js';
import { writeReport } from './report.js';
import { runEval } from './run.js';
import { type Suite, selectScenarios } from './scenarios.js';

// The demo's default engine model (apps/demo/src/server/engine-model.ts).
const DEFAULT_MODEL = 'gpt-5.6-luna';
const WORKSPACE_ROOT = resolve(import.meta.dir, '../../..');

const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: 'all' },
    arm: { type: 'string', multiple: true },
    repeats: { type: 'string', default: '3' },
    case: { type: 'string', multiple: true },
    model: { type: 'string', default: DEFAULT_MODEL },
    out: { type: 'string' },
  },
});

const suite = oneOf(values.suite, ['development', 'holdout', 'all'], 'suite');
const arms = (() => {
  try {
    return resolveArms(values.arm ?? DEFAULT_ARMS);
  } catch (error) {
    return fail(`--arm: ${error instanceof Error ? error.message : error}`);
  }
})();
const repeats = Number(values.repeats);
if (!Number.isInteger(repeats) || repeats < 1)
  fail('--repeats must be a positive integer');
const out = resolve(
  values.out ??
    join(
      WORKSPACE_ROOT,
      'tmp/planner-jev-eval',
      new Date().toISOString().replace(/[:.]/g, '-'),
    ),
);

const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY?.trim() ?? '',
  TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY?.trim() ?? '',
  JEV_MODEL: process.env.JEV_MODEL?.trim() ?? '',
};
const missing = Object.entries(env)
  .filter(([, value]) => value.length === 0)
  .map(([name]) => name);
if (missing.length > 0) {
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, 'status.json'),
    JSON.stringify({ status: 'skipped', missing }, null, 2),
  );
  console.error(
    `planner-jev eval skipped: missing ${missing.join(', ')}. Status written to ${out}/status.json`,
  );
  process.exit(2);
}

const scenarios = selectScenarios(suite as Suite | 'all', values.case ?? []);
if (scenarios.length === 0) fail('no scenario matches --suite and --case');

const model = values.model;
console.log(
  `planner-jev eval: ${scenarios.length} scenarios x ${repeats} repeats x ${arms.map((arm) => arm.name).join(', ')} (LLM ${model}, Jev ${env.JEV_MODEL})`,
);
const records = await runEval({
  scenarios,
  arms,
  repeats,
  adapter: createOpenaiChat(model as OpenAIChatModel, env.OPENAI_API_KEY),
  typesafe: { apiKey: env.TYPESAFE_API_KEY, model: env.JEV_MODEL },
  onRecord: (record) =>
    console.log(
      `${record.arm.padEnd(8)} ${record.scenarioId} #${record.repeat} ${Math.round(record.turnMs)} ms ${
        record.error
          ? `error ${record.error.tag}`
          : record.expectedDeferral
            ? record.deferredAsExpected
              ? 'deferred as expected'
              : 'expected deferral'
            : record.score?.pass
              ? 'pass'
              : 'fail'
      }${record.deferral ? ` (fallback: ${record.deferral.reason})` : ''}`,
    ),
});
await writeReport(out, records, {
  suite,
  arms: arms.map((arm) => arm.name).join(', '),
  repeats,
  scenarios: scenarios.length,
  llmModel: model,
  jevModel: env.JEV_MODEL,
  date: new Date().toISOString(),
});
console.log(`Report written to ${out}/report.md`);

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string,
): T {
  if (value !== undefined && (allowed as readonly string[]).includes(value))
    return value as T;
  return fail(`--${name} must be one of ${allowed.join(', ')}`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
