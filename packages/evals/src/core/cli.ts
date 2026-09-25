import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { consoleLogger } from '@maelstrom-co/engine';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';

import { defaultArms, type RegisteredArm, resolveArms } from './arms.js';
import {
  type GraderValidation,
  isGraderValidation,
} from './grader-validate.js';
import type { PlannerEvalPlugin } from './plugin.js';
import { loadReplay, type ReplaySource, replayedStages } from './replay.js';
import { writeReport } from './report.js';
import { runEval, unmappedPhases } from './run.js';
import { type Suite, selectScenarios } from './scenarios.js';

// The demo's default engine model (apps/demo/src/server/engine-model.ts).
const DEFAULT_MODEL = 'gpt-5.6-luna';
const WORKSPACE_ROOT = resolve(import.meta.dir, '../../../..');
// Core builds the OpenAI adapter behind every arm's LLM roles and the fallback planner.
const OPENAI_KEY = 'OPENAI_API_KEY';

/**
 * The eval command line over `plugins`: resolves the arms, checks the
 * environment they need, runs them and writes the report. `argv` is
 * `process.argv`. Exits with 1 on a usage error and 2 when a required
 * environment variable is missing, after writing `status.json`.
 */
export async function runEvalCli(
  plugins: readonly PlannerEvalPlugin[],
  argv: readonly string[],
): Promise<void> {
  const { values } = parseArgs({
    args: argv.slice(2),
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
      grader: { type: 'boolean', default: false },
      'grader-validation': { type: 'string' },
    },
  });

  const suite = oneOf(values.suite, ['development', 'holdout', 'all'], 'suite');
  const arms = (() => {
    try {
      return resolveArms(plugins, values.arm ?? defaultArms(plugins));
    } catch (error) {
      return fail(`--arm: ${error instanceof Error ? error.message : error}`);
    }
  })();
  const staged = arms.filter(({ arm }) => arm.baseline !== true);
  const replayFrom = values['replay-from'];
  const replayThrough = values['replay-through'];
  const replayArm = values['replay-arm'];
  if (
    (replayFrom === undefined) !== (replayThrough === undefined) ||
    (replayFrom === undefined) !== (replayArm === undefined)
  )
    fail(
      '--replay-from, --replay-through and --replay-arm go together: name the recorded arm to replay',
    );
  if (replayThrough !== undefined) {
    if (staged.length === 0)
      fail('--replay-from needs at least one staged arm');
    for (const { plugin } of staged)
      try {
        replayedStages(plugin, replayThrough);
      } catch (error) {
        fail(
          `--replay-through: ${error instanceof Error ? error.message : error}`,
        );
      }
  }
  const repeats = Number(values.repeats);
  if (!Number.isInteger(repeats) || repeats < 1)
    fail('--repeats must be a positive integer');
  const out = resolve(
    values.out ??
      join(
        WORKSPACE_ROOT,
        'tmp/evals',
        new Date().toISOString().replace(/[:.]/g, '-'),
      ),
  );
  const judge = values.grader
    ? plugins.map((plugin) => plugin.judge).find((candidate) => candidate)
    : undefined;
  if (values.grader && judge === undefined)
    fail('--grader needs a plugin with a judge');
  const fallback = plugins
    .map((plugin) => plugin.fallback?.bind(plugin))
    .find((candidate) => candidate);
  if (staged.length > 0 && fallback === undefined)
    fail('a staged arm needs a plugin that offers a fallback planner');

  const missing = requiredEnv(arms, judge?.requiredEnv).filter(
    (name) => (process.env[name]?.trim() ?? '').length === 0,
  );
  if (missing.length > 0) {
    await mkdir(out, { recursive: true });
    await writeFile(
      join(out, 'status.json'),
      JSON.stringify({ status: 'skipped', missing }, null, 2),
    );
    console.error(
      `planner eval skipped: missing ${missing.join(', ')}. Status written to ${out}/status.json`,
    );
    process.exit(2);
  }

  const scenarios = selectScenarios(suite as Suite | 'all', values.case ?? []);
  if (scenarios.length === 0) fail('no scenario matches --suite and --case');
  const unmapped = unmappedPhases(arms, scenarios);
  if (unmapped.length > 0) fail(unmapped.join('\n'));

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
    try {
      replay = {
        source: await loadReplay(from, replayArm),
        meta: { from, through: replayThrough, arm: replayArm },
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

  const openaiKey = process.env[OPENAI_KEY]?.trim();
  if (!openaiKey) return fail(`${OPENAI_KEY} is not set`);
  const model = values.model;
  const pluginMeta = Object.assign(
    {},
    ...plugins
      .filter((plugin) =>
        arms.some((registered) => registered.plugin === plugin),
      )
      .map((plugin) => plugin.meta?.() ?? {}),
  ) as Readonly<Record<string, unknown>>;
  console.log(
    `planner eval: ${scenarios.length} scenarios x ${repeats} repeats x ${arms.map(({ arm }) => arm.name).join(', ')} (LLM ${model}${Object.entries(
      pluginMeta,
    )
      .map(([key, value]) => `, ${key}=${value}`)
      .join('')})`,
  );
  const records = await runEval({
    scenarios,
    arms,
    repeats,
    adapter: createOpenaiChat(model as OpenAIChatModel, openaiKey),
    fallback: fallback ?? unusedFallback,
    out,
    ...(judge && { judge }),
    ...(values.verbose && { logger: consoleLogger }),
    ...(replay &&
      replayThrough && {
        replay: { source: replay.source, through: replayThrough },
      }),
    onRecord: (record) =>
      console.log(
        `${record.arm.padEnd(10)} ${record.scenarioId} #${record.repeat} ${Math.round(record.turnMs)} ms ${
          record.error
            ? `error ${record.error.tag}: ${record.error.message}`
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
      arms: arms.map(({ arm }) => arm.name).join(', '),
      repeats,
      scenarios: scenarios.length,
      llmModel: model,
      ...pluginMeta,
      date: new Date().toISOString(),
      ...(replay && { replay: replay.meta }),
      ...(values.grader && { grader: graderValidationPath ?? 'not validated' }),
    },
    { plugins, graderValidation },
  );
  console.log(`Report written to ${out}/report.md`);
}

/**
 * Every variable the run needs, each once, in the order first named: the
 * OpenAI key of the adapter core builds for every run, then what the
 * selected arms and, with `--grader`, the judge need.
 */
export function requiredEnv(
  arms: readonly RegisteredArm[],
  judgeEnv: readonly string[] = [],
): readonly string[] {
  return [
    ...new Set([
      OPENAI_KEY,
      ...arms.flatMap(({ arm }) => arm.requiredEnv ?? []),
      ...judgeEnv,
    ]),
  ];
}

// Only reached when no staged arm runs, so no arm can call it.
const unusedFallback = () => async () => {
  throw new Error('no plugin offers a fallback planner');
};

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
