import { afterEach, expect, mock, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ChatCall,
  conversation,
  DECISIONS_TEST_MODEL,
  type DecisionsScript,
  dummyAdapter,
  installMockChat,
  type Script,
  scriptedDecisionsFetch,
} from '@maelstrom-co/planner-jev/_testing';
import type { AnyTextAdapter } from '@tanstack/ai';
import { resolveArms } from '../../core/arms.js';
import { writeReport } from '../../core/report.js';
import { runEval } from '../../core/run.js';
import { selectScenarios } from '../../core/scenarios.js';
import { jevPlugin } from '../jev/plugin.js';
import type { JevRunRecord } from '../jev/record.js';
import { demoLlmPlanner, llmPlugin } from '../llm/plugin.js';
import { decisionsPluginWith } from './plugin.js';

const mockChat = installMockChat(mock);

const realFetch = globalThis.fetch;
const dirs: string[] = [];
afterEach(async () => {
  globalThis.fetch = realFetch;
  mockChat.mockReset();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

// Stands in for the provider behind chat(): every call reports usage.
const usageAdapter = {
  ...dummyAdapter,
  structuredOutput: async () => ({
    data: {},
    rawText: '{}',
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
  }),
} as unknown as AnyTextAdapter;

const BASELINE_RESPONSE = {
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
    tree: ['V:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
    instances: [
      { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
      { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
      { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
      { instanceId: 'map-main', vesselId: 'map', variant: 'overview' },
      { instanceId: 'journal-main', vesselId: 'journal', variant: 'list' },
    ],
  },
};

function mockProvider() {
  globalThis.fetch = (() => {
    throw new Error('unexpected network call');
  }) as unknown as typeof fetch;
  mockChat.mockImplementation(async (options) => {
    const { adapter } = options as ChatCall & { adapter: AnyTextAdapter };
    await adapter.structuredOutput({} as never);
    if (!('layout' in options.outputSchema.shape))
      return { userMessage: 'Done.' };
    return BASELINE_RESPONSE;
  });
}

async function outDir() {
  const out = await mkdtemp(join(tmpdir(), 'decisions-eval-'));
  dirs.push(out);
  return out;
}

function run(
  script: DecisionsScript | Script,
  ids: readonly string[],
  arms: readonly string[],
) {
  const { fetch } = scriptedDecisionsFetch(script);
  const decisions = decisionsPluginWith({
    decisions: {
      apiKey: 'decisions-test-key',
      model: DECISIONS_TEST_MODEL,
      fetch,
    },
  });
  const plugins = [llmPlugin, jevPlugin, decisions];
  return {
    plugins,
    records: runEval({
      scenarios: selectScenarios('development', ids),
      arms: resolveArms(plugins, arms),
      repeats: 1,
      adapter: usageAdapter,
      fallback: demoLlmPlanner,
    }) as Promise<JevRunRecord[]>,
  };
}

const tokyo = conversation({
  actions: [
    {
      pick: 'weather-main/setLocation',
      params: { location: { value: 'Tokyo' } },
    },
  ],
  layout: 'preserve',
  gates: {
    'gate/needsActions': 0.8,
    'gate/generatedContent': 0.05,
    'gate/spatial': 0.3,
  },
});

test('runs both Decisions arms offline, recording their kinds and every Decisions call', async () => {
  mockProvider();
  const records = await run(
    (payload, call) =>
      Object.keys(payload.questions).some((id) => id.startsWith('pair/'))
        ? { choices: {} }
        : tokyo(payload, call),
    ['quoted-location'],
    ['decisions-poc', 'decisions-composed-pairs'],
  ).records;

  expect(records.map((record) => [record.arm, record.kind])).toEqual([
    ['decisions-poc', 'decisions-poc'],
    ['decisions-composed-pairs', 'decisions'],
  ]);
  for (const record of records) {
    expect(record.error).toBe(undefined);
    expect(record.jevCalls?.length).toBeGreaterThan(0);
    for (const call of record.jevCalls ?? []) {
      expect(typeof call.latencyMs).toBe('number');
      expect(call.outcome).toBe('ok');
    }
  }
  const [poc, pairs] = records;
  expect(poc?.score?.pass).toBe(true);
  expect(poc?.fallbackCalls).toBe(0);
  expect(poc?.jevCalls?.[0]?.stage).toBe('jevSelect');
  expect(
    (pairs?.stageOutputs?.jevSelect as { gates?: unknown } | undefined)?.gates,
  ).toMatchObject({ needsActions: { answer: 'yes', probability: 0.8 } });
});

test('a refused question falls back to the LLM planner and shows as a provider_refusal row', async () => {
  mockProvider();
  const refuseFirst: DecisionsScript = (payload, call) =>
    call === 0
      ? { refuse: [Object.keys(payload.questions)[0] ?? ''] }
      : tokyo(payload, call);
  const { plugins, records: pending } = run(
    refuseFirst,
    ['quoted-location'],
    ['baseline', 'decisions-poc'],
  );
  const records = await pending;
  const refused = records[1];
  expect(refused?.deferral?.reason).toBe('jevSelect/provider_refusal');
  expect(refused?.fallbackCalls).toBe(1);
  expect(refused?.jevCalls?.map((call) => call.outcome)).toEqual([
    'provider_refusal',
  ]);

  const out = await outDir();
  await writeReport(out, records, { repeats: 1 }, { plugins });
  const report = await readFile(join(out, 'report.md'), 'utf8');
  expect(report).toContain('| Metric | baseline | decisions-poc |');
  expect(report).toMatch(
    /\| Fallbacks: jevSelect\/provider_refusal \| n\/a \| 1 \|/,
  );
});
