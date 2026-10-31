import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { loadOfflineCases } from './cases.js';
import { runOfflineCases } from './run.js';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('Offline run cannot call providers');
  };
  network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(deny, { preconnect: deny }),
  );
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
});

test('one shared run selects and repeats existing session/planner/stage cases with independent session state', async () => {
  const catalog = loadOfflineCases();
  const wanted = ['weather-chain', 'planner-preserve', 'stage-bound'];
  const selected = catalog.filter((item) =>
    wanted.includes(item.definition.id),
  );
  expect(selected).toHaveLength(3);
  let reports = 0;
  const run = await runOfflineCases({
    runId: 'offline-shared',
    cases: catalog,
    ids: [...wanted].reverse(),
    repeats: 2,
    concurrency: 3,
    report(result) {
      reports++;
      expect(result.accounting).toMatchObject({
        selectedCases: 3,
        plannedSamples: 6,
        completedSamples: 6,
      });
    },
  });
  expect(reports).toBe(1);
  expect(
    run.records.map((record) => [
      record.identity.caseId,
      record.identity.sample,
    ]),
  ).toEqual(
    selected.flatMap((item) => [
      [item.definition.id, 1],
      [item.definition.id, 2],
    ]),
  );
  expect(run.records.map((record) => record.evaluation)).toEqual(
    Array(6).fill('pass'),
  );
  expect(new Set(run.records.map((record) => record.surface))).toEqual(
    new Set(['session', 'planner-response', 'isolated-stage']),
  );
  const sessions = run.records.filter((record) => record.surface === 'session');
  expect(sessions[0].observation).toEqual(sessions[1].observation);
  expect(sessions[0].sampleKey).not.toBe(sessions[1].sampleKey);
  expect(
    run.records
      .filter((record) => record.surface !== 'session')
      .every((record) => record.operational?.scope === 'sample'),
  ).toBe(true);
});

test('offline profile selection intersects IDs and leaves excluded inventory outside execution', async () => {
  const catalog = loadOfflineCases();
  const item = catalog.find((value) => value.definition.id === 'weather-chain');
  if (!item) throw new Error('Missing synthetic session');
  const run = await runOfflineCases({
    cases: catalog,
    ids: ['weather-chain', 'planner-preserve'],
    profiles: [item.definition.profile],
    repeats: 1,
  });
  expect(run.accounting.plannedSamples).toBe(1);
  expect(run.records[0].identity.caseId).toBe('weather-chain');
  expect(run.policy).toBe('offline:declared-case/v1');
});

test('enabled judge covers every eligible offline surface and repeat, with native planner dimensions and separate session/stage/client rubrics', async () => {
  const asked: string[][] = [];
  const run = await runOfflineCases({
    repeats: 1,
    judge: {
      async score(input) {
        asked.push(input.dimensions.map((dimension) => dimension.name));
        return {
          answers: Object.fromEntries(
            input.dimensions.map((dimension) => [
              dimension.name,
              { score: dimension.levels.length - 1, probabilities: {} },
            ]),
          ),
          calls: [],
        };
      },
    },
    onEvaluation(result) {
      expect(result.judge).toBeDefined();
    },
  });
  expect(run.accounting.judge.failed).toBe(0);
  expect(run.accounting.judge.scored).toBe(
    run.records.filter(
      (record) =>
        record.disposition !== 'not_applicable' &&
        record.completeness === 'complete',
    ).length,
  );
  expect(asked).toHaveLength(run.accounting.judge.scored);
  expect(asked).toContainEqual(['request_satisfied', 'arrangement_match']);
  expect(asked).toContainEqual(['stage_alignment']);
  expect(asked).toContainEqual(['session_alignment']);
  expect(asked).toContainEqual(['application_alignment']);
});

test('partial session judging uses only retained completed turns and does not invent a final response', async () => {
  const { caseAdapter } = await import('./case-adapter.js');
  const { evaluateSample } = await import(
    '../../packages/evals/src/core/runtime/evaluate.js'
  );
  const item = loadOfflineCases().find(
    (value) => value.definition.id === 'weather-chain',
  );
  if (!item) throw new Error('Missing weather-chain');
  let asked = 0;
  const adapter = caseAdapter(item, {
    judge: {
      async score(input) {
        asked++;
        expect(input.state.completeness).toBe('partial');
        expect(input.state.observation).toHaveLength(1);
        return {
          answers: { session_alignment: { score: 1, probabilities: {} } },
          calls: [],
        };
      },
    },
  });
  let turns = 0;
  const result = await evaluateSample(
    {
      runId: 'partial',
      caseId: item.definition.id,
      runtimeId: 'fake',
      sample: 1,
    },
    {
      ...adapter,
      execute(context) {
        return adapter.execute({
          ...context,
          record(record) {
            if (record.kind === 'turn' && ++turns === 2)
              throw new Error('Scripted interruption');
            context.record(record);
          },
        });
      },
    },
  );
  expect(result.execution).toBe('error');
  expect(result.evaluation).toBe('unscored');
  expect(result.judge?.status).toBe('scored');
  expect(asked).toBe(1);
});
