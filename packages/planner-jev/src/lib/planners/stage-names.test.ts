import { describe, expect, test } from 'bun:test';

import type { Instrument, Planner, Stage } from '@maelstrom-co/engine';
import { isOk, ok } from '@maelstrom-co/protocol';

import { dummyAdapter } from '../__test-helpers__/chat-mock.js';
import {
  makeContext,
  makeInput,
  makeRequest,
} from '../__test-helpers__/fixtures.js';
import { buildJevPlanner } from '../jev-planner.js';
import { buildJevGatedBatchedPlanner } from '../planners-experimental/jev-gated-batched.js';
import { buildJevGatedBatchedPerInstancePlanner } from '../planners-experimental/jev-gated-batched-per-instance.js';
import { buildJevGatedStepwisePlanner } from '../planners-experimental/jev-gated-stepwise.js';
import { buildJevUngatedBatchedPlanner } from '../planners-experimental/jev-ungated-batched.js';
import { buildJevUngatedBatchedPerInstancePlanner } from '../planners-experimental/jev-ungated-batched-per-instance.js';
import { buildJevUngatedStepwisePlanner } from '../planners-experimental/jev-ungated-stepwise.js';
import { createJevDeps, type JevDepsOptions } from '../stages/stage-deps.js';
import { buildJevComposedPairsPlanner } from './jev-composed-pairs.js';

const options: JevDepsOptions = {
  typesafe: {
    apiKey: 'typesafe-test-key',
    model: 'jev-test',
    fetch: (() =>
      Promise.reject(new Error('no call expected'))) as unknown as typeof fetch,
  },
  adapter: dummyAdapter,
  fallback: async () => {
    throw new Error('no fallback expected');
  },
};

const BUILDERS: readonly (readonly [string, () => Planner])[] = [
  ['buildJevPlanner', () => buildJevPlanner(createJevDeps(options))],
  [
    'buildJevComposedPairsPlanner',
    () => buildJevComposedPairsPlanner(createJevDeps(options)),
  ],
  [
    'buildJevGatedBatchedPlanner',
    () => buildJevGatedBatchedPlanner(createJevDeps(options)),
  ],
  [
    'buildJevGatedBatchedPerInstancePlanner',
    () => buildJevGatedBatchedPerInstancePlanner(createJevDeps(options)),
  ],
  [
    'buildJevGatedStepwisePlanner',
    () => buildJevGatedStepwisePlanner(createJevDeps(options)),
  ],
  [
    'buildJevUngatedBatchedPlanner',
    () => buildJevUngatedBatchedPlanner(createJevDeps(options)),
  ],
  [
    'buildJevUngatedBatchedPerInstancePlanner',
    () => buildJevUngatedBatchedPerInstancePlanner(createJevDeps(options)),
  ],
  [
    'buildJevUngatedStepwisePlanner',
    () => buildJevUngatedStepwisePlanner(createJevDeps(options)),
  ],
];

describe('planner builders name their stages for the instrument', () => {
  test.each(BUILDERS)('%s', async (_name, build) => {
    const names: string[] = [];
    const replacing: Instrument = {
      stage: <In, Out>(name: string, _stage: Stage<In, Out>) => {
        names.push(name);
        return (async () => ok(undefined)) as unknown as Stage<In, Out>;
      },
      event: () => undefined,
    };
    const input = makeInput(makeRequest('hide the weather'));

    const result = await build()(
      input,
      makeContext(input, { instrument: replacing }),
    );

    expect(isOk(result)).toBe(true);
    expect(names).toEqual([
      'jevSelect',
      'jevActions',
      'jevLayout',
      'llmComplete',
    ]);
  });
});
