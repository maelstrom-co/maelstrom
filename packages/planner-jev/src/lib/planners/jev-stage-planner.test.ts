import { afterEach, describe, expect, test } from 'bun:test';

import type { Planner } from '@maelstrom-co/engine';

import { mockChat } from '../__test-helpers__/mock-chat.js';
import {
  POC_CASES,
  type PocCase,
  type PocRun,
  runPocCase,
} from '../__test-helpers__/poc-fixtures.js';
import { actionsBatchedPerInstance } from '../stages/actions-batched-per-instance.js';
import { completeLayoutInline } from '../stages/complete-layout-inline.js';
import { layoutComposedPairsGateAndDefer } from '../stages/layout-composed-pairs-gate-and-defer.js';
import { selectGated } from '../stages/select-gated.js';
import { createJevDeps, type JevDeps } from '../stages/stage-deps.js';
import { layoutPreset } from '../stages-experimental/layout-preset.js';
import { selectUngated } from '../stages-experimental/select-ungated.js';
import { buildJevStagePlanner } from './jev-stage-planner.js';

afterEach(() => mockChat.mockReset());

const GATES_ASKING_FOR_ACTIONS = {
  'gate/needsActions': 0.9,
  'gate/generatedContent': 0.1,
  'gate/spatial': 0.2,
};

const PLANNERS: readonly (readonly [string, (deps: JevDeps) => Planner])[] = [
  [
    'gated, per-instance, preset in POC wording, inline',
    (deps) =>
      buildJevStagePlanner(
        {
          select: selectGated,
          actions: actionsBatchedPerInstance,
          layout: layoutPreset,
          complete: completeLayoutInline,
        },
        deps,
      ),
  ],
  [
    'gated, per-instance, preset in placements wording, inline',
    (deps) =>
      buildJevStagePlanner(
        {
          select: selectGated,
          actions: actionsBatchedPerInstance,
          layout: (ask) => layoutPreset(ask, { describe: 'placements' }),
          complete: completeLayoutInline,
        },
        deps,
      ),
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

describe('stage planners ship what the POC ships on its fixtures', () => {
  for (const [name, build] of PLANNERS)
    for (const fixture of POC_CASES)
      test(`${name}: ${fixture.name}`, async () => {
        const run = await runPocCase(withGates(fixture), (options) =>
          build(createJevDeps(options)),
        );
        expect(run.response).toEqual(pinned[fixture.name]?.response);
        expect(run.fallbackCalls).toBe(
          pinned[fixture.name]?.fallbackCalls ?? -1,
        );
      });
});

declare const deps: JevDeps;

// Compiled by `typecheck` (tsconfig.spec.json); never executed.
function typeCases(): Planner[] {
  return [
    buildJevStagePlanner(
      {
        select: selectUngated,
        actions: actionsBatchedPerInstance,
        // @ts-expect-error layoutComposedPairsGateAndDefer routes on gates selectUngated never asks
        layout: layoutComposedPairsGateAndDefer,
        complete: completeLayoutInline,
      },
      deps,
    ),
    buildJevStagePlanner(
      {
        select: selectGated,
        actions: actionsBatchedPerInstance,
        layout: layoutComposedPairsGateAndDefer,
        complete: completeLayoutInline,
      },
      deps,
    ),
  ];
}

test('gate-routed layout stages need selectGated (type-level)', () => {
  expect(typeof typeCases).toBe('function');
});

function withGates(fixture: PocCase): PocCase {
  return {
    ...fixture,
    script: { ...fixture.script, gates: GATES_ASKING_FOR_ACTIONS },
  };
}
