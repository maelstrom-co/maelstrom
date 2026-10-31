import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import {
  jsonBackedScenarioIds,
  scenarios,
} from '../../packages/evals/src/core/scenarios.js';
import { loadOfflineCases } from './cases.js';
import { buildInventoryReport } from './inventory.js';

let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in inventory reporting');
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

test('current inventory reports exported scenarios and validated registry metadata only', () => {
  const cases = loadOfflineCases();
  const report = buildInventoryReport(scenarios, cases, jsonBackedScenarioIds);
  expect(report.counts).toEqual({
    currentScenarios: 155,
    jsonBackedScenarios: 155,
    typescriptBackedNotYetJsonSnapshottedScenarios: 0,
    cases: 43,
    fixtures: 35,
    uniqueProfiles: 30,
    caseScenarioReferences: 8,
    linkedCurrentScenarios: 5,
  });
  expect(report.currentScenarioIds).toEqual(
    scenarios.map(({ id }) => id).sort(),
  );
  expect(report.caseScenarioReferences).toEqual([
    { caseId: 'planner-deferral', scenarioId: 'generate-content' },
    { caseId: 'planner-preserve', scenarioId: 'preserve' },
    { caseId: 'replay-compatible', scenarioId: 'preserve' },
    { caseId: 'replay-incompatible', scenarioId: 'preserve' },
    { caseId: 'scripted-variant', scenarioId: 'variant' },
    { caseId: 'stage-bound', scenarioId: 'enum-route-short-name' },
    { caseId: 'stage-handoff', scenarioId: 'enum-route-short-name' },
    { caseId: 'stage-not-applicable', scenarioId: 'ns-weather-somewhere' },
  ]);
  expect(report.linkedCurrentScenarioIds).toEqual([
    'enum-route-short-name',
    'generate-content',
    'ns-weather-somewhere',
    'preserve',
    'variant',
  ]);
  expect(report.currentScenarioIdsWithoutCaseLink).toHaveLength(150);
  expect(report.currentScenarioIdsWithoutCaseLink).toEqual(
    report.currentScenarioIds.filter(
      (id) => !report.linkedCurrentScenarioIds.includes(id),
    ),
  );
  expect(report.unknownCaseScenarioReferences).toEqual([]);
  expect(
    buildInventoryReport(
      [...scenarios].reverse(),
      [...cases].reverse(),
      [...jsonBackedScenarioIds].reverse(),
    ),
  ).toEqual(report);
});

test('source-format inventory is a sorted disjoint partition of current scenario IDs', () => {
  const report = buildInventoryReport(scenarios, [], jsonBackedScenarioIds);
  expect(report.jsonBackedScenarioIds).toEqual(report.currentScenarioIds);
  const typescriptIds = report.typescriptBackedNotYetJsonSnapshottedScenarioIds;
  expect(typescriptIds).toHaveLength(0);
  expect(typescriptIds).toEqual([...typescriptIds].sort());
  expect(
    typescriptIds.filter((id) => report.jsonBackedScenarioIds.includes(id)),
  ).toEqual([]);
  expect([...report.jsonBackedScenarioIds, ...typescriptIds].sort()).toEqual(
    report.currentScenarioIds,
  );
  expect(
    report.counts.jsonBackedScenarios +
      report.counts.typescriptBackedNotYetJsonSnapshottedScenarios,
  ).toBe(report.counts.currentScenarios);
  expect(report.staleJsonBackedScenarioIds).toEqual([]);
});

test('stale JSON registry IDs are reported sorted and excluded from both source partitions', () => {
  const registry = ['stale-z', 'json', 'stale-a', 'json', 'stale-z'];
  const before = [...registry];
  const report = buildInventoryReport(
    [{ id: 'typescript' }, { id: 'json' }],
    [],
    registry,
  );
  expect(report.staleJsonBackedScenarioIds).toEqual(['stale-a', 'stale-z']);
  expect(report.jsonBackedScenarioIds).toEqual(['json']);
  expect(report.typescriptBackedNotYetJsonSnapshottedScenarioIds).toEqual([
    'typescript',
  ]);
  expect(report.counts.jsonBackedScenarios).toBe(1);
  expect(report.counts.typescriptBackedNotYetJsonSnapshottedScenarios).toBe(1);
  expect(report.counts.currentScenarios).toBe(2);
  expect(report.unknownCaseScenarioReferences).toEqual([]);
  expect(registry).toEqual(before);
});

function metadata(id: string, scenarioId?: string) {
  return {
    definition: {
      id,
      scenarioId,
      fixtureId: 'shared',
      profile: 'planner' as const,
    },
  };
}

test('multiple case links and unmapped scenarios are informational, not a bijection', () => {
  const report = buildInventoryReport(
    [{ id: 'unmapped' }, { id: 'linked' }],
    [
      metadata('second', 'linked'),
      metadata('first', 'linked'),
      metadata('none'),
    ],
    ['unmapped'],
  );
  expect(report.counts).toEqual({
    currentScenarios: 2,
    jsonBackedScenarios: 1,
    typescriptBackedNotYetJsonSnapshottedScenarios: 1,
    cases: 3,
    fixtures: 1,
    uniqueProfiles: 1,
    caseScenarioReferences: 2,
    linkedCurrentScenarios: 1,
  });
  expect(report.caseScenarioReferences).toEqual([
    { caseId: 'first', scenarioId: 'linked' },
    { caseId: 'second', scenarioId: 'linked' },
  ]);
  expect(report.currentScenarioIdsWithoutCaseLink).toEqual(['unmapped']);
  expect(report.linkedCurrentScenarioIds).toEqual(['linked']);
  expect(report.jsonBackedScenarioIds).toEqual(['unmapped']);
  expect(report.typescriptBackedNotYetJsonSnapshottedScenarioIds).toEqual([
    'linked',
  ]);
  expect(report.unknownCaseScenarioReferences).toEqual([]);
});

test('unknown case references are reported without counting them as current links', () => {
  const report = buildInventoryReport(
    [{ id: 'known' }],
    [metadata('first', 'unknown'), metadata('second', 'unknown')],
    [],
  );
  expect(report.unknownCaseScenarioReferences).toEqual([
    { caseId: 'first', scenarioId: 'unknown' },
    { caseId: 'second', scenarioId: 'unknown' },
  ]);
  expect(report.caseScenarioReferences).toEqual(
    report.unknownCaseScenarioReferences,
  );
  expect(report.counts.linkedCurrentScenarios).toBe(0);
  expect(report.currentScenarioIdsWithoutCaseLink).toEqual(['known']);
});

test('lineage scenario IDs never substitute for or add to case-level links', () => {
  const cases = [
    {
      definition: {
        ...metadata('lineage-only').definition,
        lineage: [{ source: 'current', scenarioId: 'lineage' }],
      },
    },
    {
      definition: {
        ...metadata('different', 'case-level').definition,
        lineage: [{ source: 'current', scenarioId: 'unknown-lineage' }],
      },
    },
  ];
  const before = JSON.stringify(cases);
  const report = buildInventoryReport(
    [{ id: 'lineage' }, { id: 'case-level' }],
    cases,
    [],
  );
  expect(report.caseScenarioReferences).toEqual([
    { caseId: 'different', scenarioId: 'case-level' },
  ]);
  expect(report.currentScenarioIdsWithoutCaseLink).toEqual(['lineage']);
  expect(report.unknownCaseScenarioReferences).toEqual([]);
  expect(JSON.stringify(cases)).toBe(before);
});
