import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { consoleLogger } from '@maelstrom-co/engine';
import {
  loadRecordedSpatialSignal,
  type RecordedSpatialSignal,
} from '../plugins/jev/recorded-spatial.js';
import { layoutStageEvalWith } from '../plugins/jev/stages/layout.js';
import { STAGE_EVALS } from '../plugins/jev/stages.js';
import { type Suite, selectScenarios } from './scenarios.js';
import { registerStageEval } from './stage-eval.js';
import { writeStageReport } from './stage-report.js';

const WORKSPACE_ROOT = resolve(import.meta.dir, '../../../..');

const { values } = parseArgs({
  options: {
    stage: { type: 'string' },
    variant: { type: 'string', multiple: true },
    suite: { type: 'string', default: 'development' },
    repeats: { type: 'string', default: '3' },
    case: { type: 'string', multiple: true },
    concurrency: { type: 'string', default: '1' },
    out: { type: 'string' },
    verbose: { type: 'boolean', default: false },
    'spatial-signal': { type: 'string', default: 'gold' },
    'spatial-records': { type: 'string' },
    'spatial-records-arm': {
      type: 'string',
      default: 'jev-gated-per-instance-composed-pairs-gate-and-defer-inline',
    },
  },
});

const stageName = values.stage;
const registered = stageName === undefined ? undefined : STAGE_EVALS[stageName];
if (stageName === undefined || registered === undefined)
  fail(`--stage must be one of ${Object.keys(STAGE_EVALS).join(', ')}`);
const spatialSignal = await spatialSignalOption();
const stage = spatialSignal
  ? registerStageEval(layoutStageEvalWith({ spatialSignal }))
  : registered;
const variants = values.variant ?? stage.variants;
const unknown = variants.filter((variant) => !stage.variants.includes(variant));
if (unknown.length > 0)
  fail(
    `unknown ${stageName} variant ${unknown.join(', ')}; known variants: ${stage.variants.join(', ')}`,
  );
const suite = values.suite;
if (!['development', 'holdout', 'all'].includes(suite))
  fail('--suite must be one of development, holdout, all');
const repeats = positiveInteger(values.repeats, 'repeats');
const concurrency = positiveInteger(values.concurrency, 'concurrency');
const scenarios = selectScenarios(suite as Suite | 'all', values.case ?? []);
if (scenarios.length === 0) fail('no scenario matches --suite and --case');
const out = resolve(
  values.out ??
    resolve(
      WORKSPACE_ROOT,
      'tmp/planner-jev-eval',
      `stage-${stageName}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    ),
);

const env = {
  TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY?.trim() ?? '',
  JEV_MODEL: process.env.JEV_MODEL?.trim() ?? '',
};
const missing = Object.entries(env)
  .filter(([, value]) => value.length === 0)
  .map(([name]) => name);
if (missing.length > 0) {
  console.error(
    `planner-jev stage eval skipped: missing ${missing.join(', ')}`,
  );
  process.exit(2);
}

console.log(
  `planner-jev stage eval: ${stageName}, ${scenarios.length} scenarios x ${repeats} repeats x ${variants.join(', ')} (Jev ${env.JEV_MODEL})`,
);
const records = await stage.run({
  scenarios,
  variants,
  repeats,
  concurrency,
  typesafe: { apiKey: env.TYPESAFE_API_KEY, model: env.JEV_MODEL },
  ...(values.verbose && { logger: consoleLogger }),
  onRecord: (record) =>
    console.log(
      `${record.variant.padEnd(24)} ${record.scenarioId} #${record.repeat} ${
        record.stageMs === undefined ? '' : `${Math.round(record.stageMs)} ms `
      }${record.outcome}${record.reason ? `: ${record.reason}` : ''}`,
    ),
});
await writeStageReport(
  out,
  stage.stage,
  records,
  variants,
  {
    stage: stageName,
    suite,
    variants: variants.join(', '),
    repeats,
    scenarios: scenarios.length,
    concurrency,
    jevModel: env.JEV_MODEL,
    inputs: 'gold',
    spatialSignal:
      spatialSignal === undefined
        ? 'gold'
        : `recorded live from ${values['spatial-records']} (${values['spatial-records-arm']}), gold where none was recorded`,
    ...(spatialSignal && {
      spatialSignalRecordedTurns: `${recordedTurns(spatialSignal)} of ${scenarios.length * repeats} scenario turns`,
    }),
    date: new Date().toISOString(),
  },
  stage.reportSections(records, variants),
);
console.log(`Report written to ${out}/report.md`);

async function spatialSignalOption(): Promise<
  RecordedSpatialSignal | undefined
> {
  const signal = values['spatial-signal'];
  if (signal === 'gold') return undefined;
  if (signal !== 'recorded-live')
    fail('--spatial-signal must be one of gold, recorded-live');
  if (stageName !== 'layout')
    fail('--spatial-signal recorded-live applies to --stage layout only');
  const path = values['spatial-records'];
  if (path === undefined)
    fail(
      '--spatial-signal recorded-live needs --spatial-records <records.json of a full planner eval>',
    );
  return loadRecordedSpatialSignal(
    resolve(path),
    values['spatial-records-arm'],
  );
}

function recordedTurns(signal: RecordedSpatialSignal): number {
  let found = 0;
  for (const scenario of scenarios)
    for (let repeat = 1; repeat <= repeats; repeat++)
      if (signal.lookup(scenario.id, repeat)) found++;
  return found;
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
