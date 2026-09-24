import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { FALLBACK_RETRIES, STAGE_NAMES } from '@maelstrom-co/planner-jev/_eval';
import { summarize } from '../../core/report.js';
import { RUN_RECORD_FIELDS, type RunRecord } from '../../core/run.js';
import { evalPlugins } from '../index.js';
import { BASELINE_RETRIES, llmPlugin } from '../llm/plugin.js';
import { JEV_PHASES, jevPlugin } from './plugin.js';
import type { JevTurnFields } from './record.js';

describe('the Jev plugin', () => {
  test('maps every phase to a stage of the pipeline, in order', () => {
    expect(jevPlugin.stageOrder).toEqual(STAGE_NAMES);
    expect(Object.values(JEV_PHASES) as string[]).toEqual(
      [...STAGE_NAMES].slice(0, 3) as string[],
    );
  });

  test('offers the layout stage eval under --stage layout', () => {
    expect(jevPlugin.stageModules?.map((module) => module.name)).toEqual([
      'layout',
    ]);
    expect(jevPlugin.stageModules?.[0]).toMatchObject({
      stage: 'jevLayout',
      provider: 'Jev',
      requiredEnv: ['TYPESAFE_API_KEY', 'JEV_MODEL'],
      variants: ['preset', 'preset-or-llm', 'composed-pairs'],
    });
  });

  test('the baseline is the once-retried planner the Jev arms fall back to', () => {
    expect(BASELINE_RETRIES).toBe(FALLBACK_RETRIES);
    expect(llmPlugin.fallback).toBeDefined();
  });
});

/**
 * Key-set parity with a run recorded before the plugin seam: the summary
 * the current plugins build from that run's records must have the same
 * keys, at every depth, as the summary the pre-seam code wrote, and every
 * record field must still be one the runner or the Jev plugin writes.
 *
 * `fixtures/preseam-run/` is committed: the baseline and one gated Jev arm
 * of a live development run, repeat 1 of five scenarios (a control, a
 * spatial pass, a selection deferral, and two expected deferrals). Its
 * records drop the Jev call answers and question ids, every stage output
 * but the selection gates, every answer but the gate answers, all
 * instances but the first and most of each user message; `summary.json` is
 * the pre-seam summary of exactly those trimmed records, which matched the
 * summary of the untrimmed ones.
 */
describe('summary.json and records.json parity with a pre-seam run', () => {
  const fixture = join(import.meta.dir, 'fixtures', 'preseam-run');

  test('keeps every summary key of the committed pre-seam run', async () => {
    await expectSummaryParity(fixture);
  });

  test('keeps every record field of the committed pre-seam run', async () => {
    const records = JSON.parse(
      await readFile(join(fixture, 'records.json'), 'utf8'),
    ) as Record<string, unknown>[];
    const recorded = new Set(records.flatMap((record) => Object.keys(record)));
    const written = new Set<string>([...RUN_RECORD_FIELDS, ...JEV_FIELDS]);
    expect([...recorded].filter((key) => !written.has(key))).toEqual([]);
    // Fields this recording has no occasion to write: no turn errored and none was graded.
    expect([...written].filter((key) => !recorded.has(key)).sort()).toEqual([
      'error',
      'grader',
    ]);
  });

  // Longer local runs, when present; tmp/ is not committed.
  const runs = [
    'phase5-live-gate-defer',
    'phase3-baseline',
    'mae-804-step-1-full-planner-composed',
  ].map((name) =>
    resolve(import.meta.dir, '../../../../../tmp/planner-jev-eval', name),
  );
  const present = runs.filter((dir) => existsSync(join(dir, 'summary.json')));
  test.skipIf(present.length === 0).each(present)(
    'keeps every summary key of the local run %s',
    expectSummaryParity,
  );
});

// Every field jevTurnFields can add; the check below fails to compile when one is missing.
const JEV_FIELDS = [
  'stageScores',
  'stageOutputs',
  'jevCalls',
  'answers',
  'minConfidence',
  'fill',
] as const satisfies readonly (keyof JevTurnFields)[];
const allJevFields: [
  Exclude<keyof JevTurnFields, (typeof JEV_FIELDS)[number]>,
] extends [never]
  ? true
  : false = true;
void allJevFields;

async function expectSummaryParity(dir: string): Promise<void> {
  const records = JSON.parse(
    await readFile(join(dir, 'records.json'), 'utf8'),
  ) as RunRecord[];
  const recorded = JSON.parse(
    await readFile(join(dir, 'summary.json'), 'utf8'),
  ) as { summaries: Record<string, unknown>[] };
  const rebuilt = summarize(records, evalPlugins);
  expect(rebuilt.map((summary) => `${summary.arm}/${summary.suite}`)).toEqual(
    recorded.summaries.map((summary) => `${summary.arm}/${summary.suite}`),
  );
  for (const [index, summary] of rebuilt.entries()) {
    const before = recorded.summaries[index];
    expect(keyPaths(JSON.parse(JSON.stringify(summary)))).toEqual(
      keyPaths(before),
    );
  }
}

/** Every key path of a JSON value, arrays collapsed to `[]`, sorted. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return [];
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  const dynamic = DYNAMIC_KEYS.some((path) => prefix === path);
  return Object.keys(record)
    .flatMap((key) => {
      const path = `${prefix}${key}`;
      return [
        dynamic ? `${prefix}*` : path,
        ...keyPaths(record[key], `${path}.`),
      ];
    })
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();
}

// Keyed by reason, stage or role: their keys are data, not shape.
const DYNAMIC_KEYS = [
  'fallbacks.byReason.',
  'fallbacks.byStage.',
  'fallbacks.providerByStage.',
  'latency.llmCall.',
  'tokens.llm.byRole.',
];
