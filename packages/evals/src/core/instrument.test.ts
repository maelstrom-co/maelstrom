import { describe, expect, test } from 'bun:test';

import { named, pipeline } from '@maelstrom-co/engine';
import { ok } from '@maelstrom-co/protocol';
import { TOKYO_CANDIDATE } from './__test-helpers__/fake-planner.js';
import {
  makeContext,
  makeInput,
  makeRequest,
} from './__test-helpers__/fixtures.js';
import { createRecorder } from './instrument.js';

describe('createRecorder', () => {
  test('records the named stages of a pipeline run with its instrument, and the events they report', async () => {
    const recorder = createRecorder();
    const input = makeInput(makeRequest('hide the weather'));
    const planner = pipeline(
      named('pick', async (_input: typeof input, ctx) => {
        ctx.instrument.event('test.call', { 'maelstrom.stage': 'pick' });
        return ok('picked');
      }),
      named('write', async (_picked: string) => ok(TOKYO_CANDIDATE)),
    );

    await planner(input, makeContext(input, recorder.instrument));

    expect(recorder.stages).toMatchObject([
      { stage: 'pick', outcome: 'ok', input, output: 'picked' },
      {
        stage: 'write',
        outcome: 'ok',
        input: 'picked',
        output: TOKYO_CANDIDATE,
      },
    ]);
    expect(recorder.events).toEqual([
      { name: 'test.call', attributes: { 'maelstrom.stage': 'pick' } },
    ]);
  });
});
