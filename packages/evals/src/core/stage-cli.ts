import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { consoleLogger } from '@maelstrom-co/engine';
import {
  type ConfigureJudge,
  MissingJudgeEnvironment,
  unconfiguredJudge,
} from './judge.js';
import { renderJudgeSummary, summarizeJudges } from './judge-result.js';

import { type Suite, selectScenarios } from './scenarios.js';
import type { RegisteredStageEval } from './stage-eval.js';
import { writeStageReport } from './stage-report.js';

const WORKSPACE_ROOT = resolve(import.meta.dir, '../../../..');

/**
 * The stage eval command line: runs one of `modules` (chosen with
 * `--stage`) on the selected scenarios and writes its report. `argv` is
 * `process.argv`. Exits with 1 on a usage error and 2 when the module's
 * environment variables are missing.
 *
 * @throws {Error} When two of `modules` share a name, before reading `argv`.
 */
export async function runStageEvalCli(
  modules: readonly RegisteredStageEval[],
  argv: readonly string[],
  configureJudge: ConfigureJudge = unconfiguredJudge,
): Promise<void> {
  assertUniqueStageModules(modules);
  const { values: parsed } = parseArgs({
    args: argv.slice(2),
    options: {
      stage: { type: 'string' },
      variant: { type: 'string', multiple: true },
      suite: { type: 'string', default: 'development' },
      repeats: { type: 'string', default: '3' },
      case: { type: 'string', multiple: true },
      concurrency: { type: 'string', default: '1' },
      out: { type: 'string' },
      verbose: { type: 'boolean', default: false },
      grader: { type: 'boolean' },
      'no-grader': { type: 'boolean' },
      'judge-provider': { type: 'string' },
      'judge-model': { type: 'string' },
      'judge-rubric': { type: 'string' },
      ...Object.assign({}, ...modules.map((module) => module.flags ?? {})),
    },
  });
  const values = parsed as Readonly<Record<string, unknown>>;

  if (values.grader && values['no-grader'])
    fail('--grader and --no-grader conflict');
  let judgeMissing: readonly string[] = [];
  const judging = (() => {
    try {
      return configureJudge(
        {
          enabled: values['no-grader']
            ? false
            : (values.grader as boolean | undefined),
          provider: values['judge-provider'] as string | undefined,
          model: values['judge-model'] as string | undefined,
          rubric: values['judge-rubric'] as string | undefined,
        },
        process.env,
      );
    } catch (error) {
      if (error instanceof MissingJudgeEnvironment) {
        judgeMissing = error.missing;
        return {};
      }
      return fail(error instanceof Error ? error.message : String(error));
    }
  })();
  const stageName = String(values.stage ?? '');
  const registered = modules.find((module) => module.name === stageName);
  if (registered === undefined)
    fail(
      `--stage must be one of ${modules.map((module) => module.name).join(', ')}`,
    );
  const suite = String(values.suite);
  if (!['development', 'holdout', 'all'].includes(suite))
    fail('--suite must be one of development, holdout, all');
  const repeats = positiveInteger(String(values.repeats), 'repeats');
  const concurrency = positiveInteger(
    String(values.concurrency),
    'concurrency',
  );
  const cases = (values.case ?? []) as readonly string[];
  const scenarios = selectScenarios(suite as Suite | 'all', cases);
  if (scenarios.length === 0) fail('no scenario matches --suite and --case');
  let stage: RegisteredStageEval;
  let moduleMeta: Readonly<Record<string, string | number | boolean>>;
  try {
    const configured = await registered.configure(values, {
      scenarios,
      repeats,
    });
    stage = configured.module;
    moduleMeta = configured.meta;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  const variants =
    (values.variant as readonly string[] | undefined) ?? stage.variants;
  const unknown = variants.filter(
    (variant) => !stage.variants.includes(variant),
  );
  if (unknown.length > 0)
    fail(
      `unknown ${stageName} variant ${unknown.join(', ')}; known variants: ${stage.variants.join(', ')}`,
    );
  const out = resolve(
    (values.out as string | undefined) ??
      resolve(
        WORKSPACE_ROOT,
        'tmp/evals',
        `stage-${stageName}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
      ),
  );

  const missing = [...judgeMissing, ...(stage.requiredEnv ?? [])].filter(
    (name) => (process.env[name]?.trim() ?? '').length === 0,
  );
  if (missing.length > 0) {
    console.error(`stage eval skipped: missing ${missing.join(', ')}`);
    process.exit(2);
  }

  console.log(
    `stage eval: ${stageName}, ${scenarios.length} scenarios x ${repeats} repeats x ${variants.join(', ')}${describe(moduleMeta)}`,
  );
  await stage.run({
    ...judging,
    scenarios,
    variants,
    repeats,
    concurrency,
    ...(values.verbose === true && { logger: consoleLogger }),
    report: ({ records }) =>
      writeStageReport(
        out,
        stage,
        records,
        variants,
        {
          stage: stageName,
          suite,
          variants: variants.join(', '),
          repeats,
          scenarios: scenarios.length,
          concurrency,
          ...moduleMeta,
          date: new Date().toISOString(),
        },
        stage.reportSections(records, variants),
      ),
    onRecord: (record) =>
      console.log(
        `${record.variant.padEnd(24)} ${record.scenarioId} #${record.repeat} ${
          record.stageMs === undefined
            ? ''
            : `${Math.round(record.stageMs)} ms `
        }${record.outcome}${record.reason ? `: ${record.reason}` : ''} (${renderJudgeSummary(summarizeJudges([record.judge]))})`,
      ),
  });

  console.log(`Report written to ${out}/report.md`);
}

/**
 * Refuses a registry where two stage modules share a `--stage` name, since
 * the CLI would silently run only the first.
 *
 * @throws {Error} Naming the first name registered twice.
 */
export function assertUniqueStageModules(
  modules: readonly RegisteredStageEval[],
): void {
  const seen = new Set<string>();
  for (const module of modules) {
    if (seen.has(module.name))
      throw new Error(`stage module ${module.name} is registered twice`);
    seen.add(module.name);
  }
}

function describe(
  meta: Readonly<Record<string, string | number | boolean>>,
): string {
  const entries = Object.entries(meta);
  return entries.length === 0
    ? ''
    : ` (${entries.map(([key, value]) => `${key}=${value}`).join(', ')})`;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    fail(`--${name} must be a positive integer`);
  return parsed;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
