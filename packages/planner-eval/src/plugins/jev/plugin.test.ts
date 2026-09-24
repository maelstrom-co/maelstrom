import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { FALLBACK_RETRIES, STAGE_NAMES } from '@maelstrom-co/planner-jev/_eval';
import { summarize } from '../../core/report.js';
import type { RunRecord } from '../../core/run.js';
import { BASELINE_RETRIES, llmPlugin } from '../llm/plugin.js';
import { JEV_PHASES, jevPlugin } from './plugin.js';

const plugins = [llmPlugin, jevPlugin];

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
 * keys, at every depth, as the summary the run wrote. Skipped when no such
 * run is present (the directory is not committed).
 */
describe('summary.json parity with a recorded run', () => {
  const runs = [
    'phase5-live-gate-defer',
    'phase3-baseline',
    'mae-804-step-1-full-planner-composed',
  ].map((name) =>
    resolve(import.meta.dir, '../../../../../tmp/planner-jev-eval', name),
  );
  const present = runs.filter((dir) => existsSync(join(dir, 'summary.json')));

  test.skipIf(present.length === 0).each(present)(
    'keeps every summary key of %s',
    async (dir) => {
      const records = JSON.parse(
        await readFile(join(dir, 'records.json'), 'utf8'),
      ) as RunRecord[];
      const recorded = JSON.parse(
        await readFile(join(dir, 'summary.json'), 'utf8'),
      ) as { summaries: Record<string, unknown>[] };
      const rebuilt = summarize(records, plugins);
      expect(
        rebuilt.map((summary) => `${summary.arm}/${summary.suite}`),
      ).toEqual(
        recorded.summaries.map((summary) => `${summary.arm}/${summary.suite}`),
      );
      for (const [index, summary] of rebuilt.entries()) {
        const before = recorded.summaries[index];
        expect(keyPaths(JSON.parse(JSON.stringify(summary)))).toEqual(
          keyPaths(before),
        );
      }
    },
  );
});

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
