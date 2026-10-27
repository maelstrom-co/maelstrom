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
