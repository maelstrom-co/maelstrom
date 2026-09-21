import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { conversation } from '../src/lib/__test-helpers__/actions-fixtures.js';
import {
  dummyAdapter,
  mockChat,
} from '../src/lib/__test-helpers__/mock-chat.js';
import {
  scriptedFetch,
  TEST_MODEL,
} from '../src/lib/__test-helpers__/scripted-fetch.js';
import { writeReport } from './report.js';
import { runEval } from './run.js';
import { selectScenarios } from './scenarios.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  mockChat.mockReset();
});

test('runs both arms offline and writes a complete report', async () => {
  globalThis.fetch = (() => {
    throw new Error('unexpected network call');
  }) as unknown as typeof fetch;
  mockChat.mockImplementation(async (options) => {
    if (!('layout' in options.outputSchema.shape))
      return { userMessage: 'Done.' };
    return {
      userMessage: 'Baseline done.',
      rationale: 'r',
      executionPlan: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          paramsJson: '{"location":"Tokyo"}',
        },
      ],
      layout: {
        tree: [
          'V:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
        instances: [
          {
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'month',
          },
          {
            instanceId: 'weather-main',
            vesselId: 'weather',
            variant: 'current',
          },
          { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
          { instanceId: 'map-main', vesselId: 'map', variant: 'overview' },
          { instanceId: 'journal-main', vesselId: 'journal', variant: 'list' },
        ],
      },
    };
  });
  const { fetch } = scriptedFetch(
    conversation({
      actions: [
        {
          pick: 'weather-main/setLocation',
          params: { location: { value: 'Tokyo' } },
        },
      ],
      layout: 'preserve',
    }),
  );

  const records = await runEval({
    scenarios: selectScenarios('development', ['quoted-location', 'ambiguous']),
    arms: ['baseline', 'jev'],
    repeats: 1,
    adapter: dummyAdapter,
    typesafe: { apiKey: 'typesafe-test-key', model: TEST_MODEL, fetch },
  });

  expect(records.map((r) => `${r.scenarioId}/${r.arm}`)).toEqual([
    'quoted-location/baseline',
    'quoted-location/jev',
    'ambiguous/baseline',
    'ambiguous/jev',
  ]);
  const jevQuoted = records[1];
  expect(jevQuoted?.score?.pass).toBe(true);
  expect(jevQuoted?.fallbackCalls).toBe(0);
  expect(jevQuoted?.stageScores?.actions?.pass).toBe(true);
  expect(jevQuoted?.jevCalls?.length).toBeGreaterThan(0);
  expect(records[0]?.score?.pass).toBe(true);
  // The script answers "supported", so the expected jevSelect deferral does not happen.
  expect(records[3]?.deferredAsExpected).toBe(false);

  const out = await mkdtemp(join(tmpdir(), 'planner-jev-eval-'));
  try {
    await writeReport(out, records, { repeats: 1 });
    const report = await readFile(join(out, 'report.md'), 'utf8');
    expect(report).toContain('## development');
    expect(report).toContain('Overall pass');
    const summary = JSON.parse(
      await readFile(join(out, 'summary.json'), 'utf8'),
    );
    expect(summary.summaries.length).toBeGreaterThan(0);
    const saved = JSON.parse(await readFile(join(out, 'records.json'), 'utf8'));
    expect(saved).toHaveLength(4);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
