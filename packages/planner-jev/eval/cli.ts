import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { consoleLogger } from '@maelstrom-co/engine';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';

import { DEFAULT_ARMS, resolveArms } from './arms.js';
import {
  type GraderValidation,
  isGraderValidation,
} from './grader-validate.js';
import {
  loadReplay,
  REPLAY_THROUGH,
  type ReplaySource,
  replayedStages,
} from './replay.js';
import { writeReport } from './report.js';
import { checkRunModes, runEval, STOP_AFTER } from './run.js';
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
    verbose: { type: 'boolean', default: false },
    'replay-from': { type: 'string' },
    'replay-through': { type: 'string' },
    'replay-arm': { type: 'string' },
    'stop-after': { type: 'string' },
    'gold-inputs': { type: 'boolean', default: false },
    grader: { type: 'boolean', default: false },
    'grader-validation': { type: 'string' },
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
const replayFrom = values['replay-from'];
const replayThrough =
  values['replay-through'] === undefined
    ? undefined
    : oneOf(values['replay-through'], REPLAY_THROUGH, 'replay-through');
const replayArm = values['replay-arm'];
if (
  (replayFrom === undefined) !== (replayThrough === undefined) ||
  (replayFrom === undefined) !== (replayArm === undefined)
)
  fail(
    '--replay-from, --replay-through and --replay-arm go together: name the recorded arm to replay',
  );
if (replayFrom !== undefined && arms.every((arm) => arm.kind === 'baseline'))
  fail('--replay-from needs at least one Jev arm');
const stopAfter =
  values['stop-after'] === undefined
    ? undefined
    : oneOf(values['stop-after'], STOP_AFTER, 'stop-after');
const goldInputs = values['gold-inputs'];
try {
  checkRunModes({ arms, stopAfter, goldInputs, replay: replayFrom });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
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

let replay:
  | {
      readonly source: ReplaySource;
      readonly meta: { from: string; through: string; arm: string };
    }
  | undefined;
if (
  replayFrom !== undefined &&
  replayThrough !== undefined &&
  replayArm !== undefined
) {
  const from = resolve(replayFrom);
  const arm = replayArm;
  try {
    replay = {
      source: await loadReplay(from, arm),
      meta: { from, through: replayThrough, arm },
    };
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

const graderValidationPath = values['grader-validation'];
if (graderValidationPath !== undefined && !values.grader)
  fail('--grader-validation needs --grader');
let graderValidation: GraderValidation | undefined;
if (graderValidationPath !== undefined) {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(resolve(graderValidationPath), 'utf8'));
  } catch (error) {
    fail(
      `--grader-validation ${graderValidationPath}: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (!isGraderValidation(raw))
    fail(
      `--grader-validation ${graderValidationPath}: not a well-formed grader validation`,
    );
  graderValidation = raw;
}

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
  out,
  grader: values.grader,
  ...(stopAfter && { stopAfter }),
  goldInputs,
  ...(values.verbose && { logger: consoleLogger }),
  ...(replay &&
    replayThrough && {
      replay: {
        source: replay.source,
        stages: replayedStages(replayThrough),
      },
    }),
  onRecord: (record) =>
    console.log(
      `${record.arm.padEnd(10)} ${record.scenarioId} #${record.repeat} ${Math.round(record.turnMs)} ms ${
        record.notApplicable
          ? `not applicable: ${record.notApplicable}`
          : record.error
            ? `error ${record.error.tag}: ${record.error.message}`
            : record.layoutOnly === 'handed_off'
              ? 'handed off'
              : record.expectedDeferral
                ? record.deferredAsExpected
                  ? 'deferred as expected'
                  : 'expected deferral'
                : record.score?.pass
                  ? 'pass'
                  : 'fail'
      }${record.deferral ? ` (fallback: ${record.deferral.reason})` : ''}${
        record.grader?.failure
          ? ` (grader failed: ${record.grader.failure})`
          : ''
      }`,
    ),
});
await writeReport(
  out,
  records,
  {
    suite,
    arms: arms.map((arm) => arm.name).join(', '),
    repeats,
    scenarios: scenarios.length,
    llmModel: model,
    jevModel: env.JEV_MODEL,
    date: new Date().toISOString(),
    ...(replay && { replay: replay.meta }),
    stopAfter: stopAfter ?? 'none',
    goldInputs,
    ...(values.grader && { grader: graderValidationPath ?? 'not validated' }),
  },
  graderValidation,
  scenarios,
);
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
