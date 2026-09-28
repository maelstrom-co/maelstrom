import { afterEach, describe, expect, test } from 'bun:test';

import type { Planner } from '@maelstrom-co/engine';

import { mockChat } from '../__test-helpers__/mock-chat.js';
import {
  POC_CASES,
  type PocCase,
  type PocRun,
  runPocCase,
} from '../__test-helpers__/poc-fixtures.js';
import { createJevDeps, type JevDeps } from '../stages/stage-deps.js';
import { buildJevGatedBatchedPlanner } from './jev-gated-batched.js';
import { buildJevGatedBatchedPerInstancePlanner } from './jev-gated-batched-per-instance.js';
import { buildJevGatedStepwisePlanner } from './jev-gated-stepwise.js';
import { buildJevUngatedBatchedPlanner } from './jev-ungated-batched.js';
import { buildJevUngatedBatchedPerInstancePlanner } from './jev-ungated-batched-per-instance.js';

afterEach(() => mockChat.mockReset());

const GATES_ASKING_FOR_ACTIONS = {
  'gate/needsActions': 0.9,
  'gate/generatedContent': 0.1,
  'gate/spatial': 0.2,
};

const PLANNERS: readonly (readonly [
  string,
  (deps: JevDeps) => Planner,
  boolean,
])[] = [
  ['jev-ungated-batched-preset-inline', buildJevUngatedBatchedPlanner, false],
  [
    'jev-ungated-per-instance-preset-inline',
    buildJevUngatedBatchedPerInstancePlanner,
    false,
  ],
  ['jev-gated-stepwise-preset-inline', buildJevGatedStepwisePlanner, true],
  ['jev-gated-batched-preset-inline', buildJevGatedBatchedPlanner, true],
  [
    'jev-gated-per-instance-preset-inline',
    buildJevGatedBatchedPerInstancePlanner,
    true,
  ],
];

const pinned: Record<string, PocRun> = {};
for (const fixture of POC_CASES)
  pinned[fixture.name] = await Bun.file(
    new URL(
      `../__test-helpers__/poc-evaluations/${fixture.name}.json`,
      import.meta.url,
    ),
  ).json();

describe('actions-variant planners ship what the POC ships on its fixtures', () => {
  for (const [name, build, gated] of PLANNERS)
    for (const fixture of POC_CASES)
      test(`${name}: ${fixture.name}`, async () => {
        const run = await runPocCase(withGates(fixture, gated), (options) =>
          build(createJevDeps(options)),
        );
        expect(run.response).toEqual(pinned[fixture.name]?.response);
        expect(run.fallbackCalls).toBe(
          pinned[fixture.name]?.fallbackCalls ?? -1,
        );
      });
});

describe('gated planners', () => {
  test('a generated-content gate falls back before any actions call', async () => {
    const [fixture] = POC_CASES as [PocCase];
    const run = await runPocCase(
      {
        ...fixture,
        script: {
          ...fixture.script,
          gates: {
            ...GATES_ASKING_FOR_ACTIONS,
            'gate/generatedContent': 0.95,
          },
        },
      },
      (options) => buildJevGatedBatchedPlanner(createJevDeps(options)),
    );
    expect(run.fallbackCalls).toBe(1);
    expect(run.evaluations).toHaveLength(1);
  });
});

function withGates(fixture: PocCase, gated: boolean): PocCase {
  if (!gated) return fixture;
  return {
    ...fixture,
    script: { ...fixture.script, gates: GATES_ASKING_FOR_ACTIONS },
  };
}
