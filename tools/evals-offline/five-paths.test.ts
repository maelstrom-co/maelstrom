import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  createEvaluationPublisher,
  prepareEvaluationPublication,
} from '../../packages/evals/src/core/publication.js';
import type { ReplaySource } from '../../packages/evals/src/core/replay.js';
import { evaluateSample } from '../../packages/evals/src/core/runtime/evaluate.js';
import { caseAdapter } from './case-adapter.js';
import { loadOfflineCases } from './cases.js';
import { clientFixture } from './client-fixture.js';
import { legacyWeather } from './legacy-fixture.js';
import { planner, preserve, stage } from './runtime-fixtures.js';

const identity = (caseId: string, runtimeId = 'scripted', sample = 1) => ({
  runId: 'offline-phase1',
  caseId,
  runtimeId,
  sample,
});
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network allowed in offline evaluations');
  };
  network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(deny, { preconnect: deny }),
  );
});
afterEach(() => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

test('all indexed paths use one lifecycle and serializable result envelope', async () => {
  const cases = loadOfflineCases();
  const results = [];
  for (const item of cases)
    results.push(
      await evaluateSample(
        identity(item.definition.id, item.definition.profile),
        caseAdapter(item),
      ),
    );
  expect(results.map((result) => result.execution)).toEqual(
    cases.map((item) =>
      item.definition.id === 'replay-incompatible' ? 'invalid' : 'completed',
    ),
  );
  expect(results.map((result) => result.evaluation)).toEqual([
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'unscored',
    'pass',
    'not_applicable',
    'pass',
    'unscored',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  expect(results[5].disposition).toBe('handed_off');
  const published: string[] = [];
  const publisher = createEvaluationPublisher({
    destinationId: 'synthetic-memory',
    timeoutMs: 100,
    maxEntries: cases.length,
    sink: {
      publish: async (publication) => {
        published.push(publication.json);
        return { status: 'accepted' };
      },
    },
  });
  for (const result of results) {
    expect(result.schemaVersion).toBe(1);
    if (result.execution === 'completed') {
      expect(result.completeness).toBe('complete');
      expect(result.records.length).toBeGreaterThan(0);
    }
    expect(
      result.records.every((record) => record.sampleKey === result.sampleKey),
    ).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    const before = structuredClone(result);
    const publication = prepareEvaluationPublication(result, {
      destinationId: 'synthetic-memory',
      artifactId: 'summary',
      policy: { maxBytes: 4096, review: () => true },
    });
    expect((await publisher.publish(publication)).status).toBe('accepted');
    expect((await publisher.publish(publication)).status).toBe('accepted');
    expect(result).toEqual(before);
  }
  expect(published).toHaveLength(cases.length);
  expect(published.map((json) => JSON.parse(json).evaluation)).toEqual(
    results.map((result) => result.evaluation),
  );
  expect(
    published.every((json) => JSON.parse(json).recording === undefined),
  ).toBe(true);
});

test('legacy-derived controls detect wrong targets/actions and missing later turns; harmless IDs pass', async () => {
  for (const fault of ['wrong-target', 'wrong-action'] as const) {
    const result = await evaluateSample(
      identity('legacy-D15'),
      legacyWeather(['weekly'], { fault }),
    );
    expect(result.evaluation).toBe('fail');
    expect(result.failures.length).toBeGreaterThan(0);
  }
  const equivalent = await evaluateSample(
    identity('legacy-D15'),
    legacyWeather(['weekly'], { id: 'equivalent-instance-name' }),
  );
  expect(equivalent.evaluation).toBe('pass');
  const adapter = legacyWeather(['hourly', 'weekly', 'current']);
  for (const sample of [1, 2]) {
    const result = await evaluateSample(
      identity('legacy-D31', 'scripted', sample),
      adapter,
    );
    expect(result.evaluation).toBe('pass');
    expect(result.observation?.map((turn) => turn.state.variant)).toEqual([
      'current',
      'hourly',
      'weekly',
    ]);
  }
  const failed = await evaluateSample(
    identity('legacy-D31'),
    legacyWeather(['hourly', 'weekly', 'current'], { failAt: 1 }),
  );
  expect(failed.execution).toBe('error');
  expect(failed.evaluation).toBe('unscored');
  expect(failed.completeness).toBe('partial');
  expect(
    failed.records.filter((record) => record.kind === 'turn'),
  ).toHaveLength(1);
  const stale = await evaluateSample(
    identity('legacy-D31'),
    legacyWeather(['hourly', 'weekly', 'current'], { fault: 'lost-state' }),
  );
  expect(stale.execution).toBe('error');
  expect(stale.error?.message).toContain('History/state mismatch');
});

test('single-turn and final-turn-only lost state fail even when outputs claim the expected Variant', async () => {
  const single = await evaluateSample(
    identity('legacy-D15'),
    legacyWeather(['weekly'], { fault: 'lost-state' }),
  );
  expect(single.execution).toBe('completed');
  expect(single.evaluation).toBe('fail');
  expect(single.failures).toEqual([
    'Turn 0 did not retain the resulting state',
  ]);
  expect(single.observation?.[0]).toMatchObject({
    state: { variant: 'current' },
    output: { variant: 'weekly' },
    resultingState: { variant: 'current' },
  });
  expect(
    single.records.find((record) => record.kind === 'turn')?.value,
  ).toEqual(single.observation?.[0]);

  const last = await evaluateSample(
    identity('legacy-D31'),
    legacyWeather(['hourly', 'weekly', 'current'], {
      fault: 'last-turn-lost-state',
    }),
  );
  expect(last.execution).toBe('completed');
  expect(last.evaluation).toBe('fail');
  expect(last.failures).toEqual(['Turn 2 did not retain the resulting state']);
  expect(last.observation?.map((turn) => turn.resultingState.variant)).toEqual([
    'hourly',
    'weekly',
    'weekly',
  ]);
  expect(last.observation?.at(-1)?.output.variant).toBe('current');
  if (!last.observation) throw new Error('Expected completed session evidence');
  expect(
    last.records
      .filter((record) => record.kind === 'turn')
      .map((record) => record.value),
  ).toEqual([...last.observation]);
});

test('session oracle rejects missing turns, stale pre-state and wrong final Variants independently of the executor', async () => {
  const adapter = legacyWeather(['hourly', 'weekly', 'current']);
  const positive = await evaluateSample(identity('legacy-D31'), adapter);
  const turns = positive.observation;
  if (!turns) throw new Error('Expected complete synthetic turns');
  const broken = [
    turns.slice(0, 2),
    turns.map((turn, index) =>
      index === 2
        ? {
            ...turn,
            resultingState: {
              ...turn.resultingState,
              instanceId: 'lost-final-target',
            },
          }
        : turn,
    ),
    turns.map((turn, index) =>
      index === 1
        ? {
            ...turn,
            state: { ...turn.state, instanceId: 'swapped' },
            output: { ...turn.output, instanceId: 'swapped' },
          }
        : turn,
    ),
    turns.map((turn, index) => (index === 1 ? { ...turn, index: 7 } : turn)),
    turns.map((turn, index) =>
      index === 1
        ? { ...turn, state: { ...turn.state, variant: 'current' as const } }
        : turn,
    ),
    turns.map((turn, index) =>
      index === 2
        ? { ...turn, output: { ...turn.output, variant: 'weekly' as const } }
        : turn,
    ),
  ];
  for (const value of broken) {
    const result = await evaluateSample(identity('legacy-D31'), {
      ...adapter,
      execute: async () => ({
        completeness: 'complete',
        disposition: 'planned',
        value,
      }),
    });
    expect(result.execution).toBe('completed');
    expect(result.evaluation).toBe('fail');
    expect(result.failures.length).toBeGreaterThan(0);
  }
});

test('real client effects detect reversed ordering and lost source-Variant handler; valid async readiness passes', async () => {
  const correct = await evaluateSample(
    identity('application'),
    clientFixture(),
  );
  expect(correct.evaluation).toBe('pass');
  expect(
    correct.records.some(
      (record) =>
        record.requestId !== undefined && record.kind === 'diagnostic',
    ),
  ).toBe(true);
  for (const fault of ['reverse-order', 'replace-source-runner'] as const) {
    const result = await evaluateSample(
      identity('application'),
      clientFixture(fault),
    );
    expect(result.execution).toBe('completed');
    expect(result.evaluation).toBe('fail');
    expect(result.failures.length).toBeGreaterThan(0);
  }
});

test('stage hand-off, positive stage verdict, N/A and expected planner deferral stay distinct', async () => {
  const positive = stage('enum-route-short-name', false);
  expect(
    (await evaluateSample(identity('stage'), positive.adapter)).evaluation,
  ).toBe('pass');
  const missing = stage('ns-weather-somewhere');
  const result = await evaluateSample(
    identity('missing-input'),
    missing.adapter,
  );
  expect(result.evaluation).toBe('not_applicable');
  expect(missing.calls).toHaveLength(0);
  const deferred = await evaluateSample(
    identity('generate-content'),
    planner(undefined, { count: 0 }, true),
  );
  expect(deferred.disposition).toBe('deferred');
  expect(deferred.evaluation).toBe('pass');
});

test('compatible synthetic replay keeps provenance; incompatible replay rejects before runtime calls', async () => {
  const input = { request: preserve.request, history: [] };
  const source: ReplaySource = {
    dir: 'synthetic-memory',
    turn: () => ({
      key: 'preserve #1',
      stages: [
        {
          stage: 'pick',
          ms: 1,
          outcome: 'ok',
          input,
          output: {
            input,
            picked: preserve.request.instances.map(
              (instance) => instance.instanceId,
            ),
          },
        },
      ],
    }),
  };
  const calls = { count: 0 };
  const compatible = await evaluateSample(
    identity('preserve'),
    planner(source, calls),
  );
  expect(compatible.evaluation).toBe('pass');
  expect(compatible.observation?.stages?.[0]?.replayed).toBe(true);
  expect(calls.count).toBe(1);
  calls.count = 0;
  const incompatible: ReplaySource = {
    ...source,
    turn: () => ({
      key: 'preserve #1',
      stages: [
        {
          stage: 'pick',
          ms: 1,
          outcome: 'ok',
          input: {
            request: {
              ...preserve.request,
              reason: { type: 'user_intent', text: 'different input' },
            },
          },
          output: {},
        },
      ],
    }),
  };
  const rejected = await evaluateSample(
    identity('preserve'),
    planner(incompatible, calls),
  );
  expect(rejected.execution).toBe('invalid');
  expect(rejected.error?.phase).toBe('preflight');
  expect(calls.count).toBe(0);
  expect(rejected.records).toHaveLength(0);
});
