import { describe, expect, test } from 'bun:test';

import { isOk } from '@maelstrom-co/protocol';

import {
  type Conversation,
  conversation,
} from '../__test-helpers__/actions-fixtures.js';
import {
  deferralOf,
  makeContext,
  makeInput,
  makeRequest,
} from '../__test-helpers__/fixtures.js';
import { scriptedAsk } from '../__test-helpers__/scripted-fetch.js';
import { runPair } from '../__test-helpers__/stage-pair.js';
import { GATE_THRESHOLD, selectWithGates } from './select-gate.js';
import { selectUngated } from './select-ungated.js';

const GATES = {
  'gate/needsActions': 0.9,
  'gate/generatedContent': 0.1,
  'gate/spatial': 0.25,
};

function pair(intent: string, script: Conversation) {
  const input = makeInput(makeRequest(intent));
  return runPair(
    selectUngated,
    selectWithGates,
    input,
    input,
    conversation(script),
  );
}

describe('selectWithGates', () => {
  test('records every gate answer with its probability and confidence', async () => {
    const { next } = await pair('set the weather to Oslo', { gates: GATES });
    expect(isOk(next.result) && next.result.value.gates).toEqual({
      needsActions: { answer: 'yes', probability: 0.9, confidence: 0.8 },
      generatedContent: { answer: 'no', probability: 0.1, confidence: 0.8 },
      spatial: { answer: 'no', probability: 0.25, confidence: 0.5 },
    });
  });

  test('answers yes at the threshold', async () => {
    const { next } = await pair('put the map on the left', {
      gates: { ...GATES, 'gate/spatial': GATE_THRESHOLD },
    });
    expect(isOk(next.result) && next.result.value.gates.spatial.answer).toBe(
      'yes',
    );
  });

  test('asks the POC selection and the gates in one call, and otherwise selects like it', async () => {
    const script: Conversation = {
      select: { 'view/tasks-main': 'hide', 'new/map': 'one/overview' },
      gates: GATES,
    };
    const { poc, next } = await pair('hide the tasks, add a map', script);
    expect(next.calls).toHaveLength(1);
    const [gated] = next.calls;
    const [ungated] = poc.calls;
    expect(gated?.state).toEqual(ungated?.state ?? {});
    expect(Object.keys(gated?.questions ?? {})).toEqual([
      ...Object.keys(ungated?.questions ?? {}),
      'gate/needsActions',
      'gate/generatedContent',
      'gate/spatial',
    ]);
    expect(gated?.questions['gate/spatial']).toEqual({
      type: 'noul',
      instructions:
        'The latest intent states where something goes or how large it is.',
    } as never);
    expect(isOk(next.result)).toBe(true);
    expect((poc.result as { value: unknown }).value).toEqual(
      withoutGates((next.plain as { value: object }).value),
    );
  });

  test('defers generated content as unsupported at select', async () => {
    const { ask, calls } = scriptedAsk(
      conversation({ gates: { ...GATES, 'gate/generatedContent': 0.8 } }),
    );
    const input = makeInput(makeRequest('write a poem in my journal'));
    const result = await selectWithGates(ask)(input, makeContext(input));
    expect(deferralOf(result)).toBe('jevSelect/scope_unsupported');
    expect(calls).toHaveLength(1);
  });

  test("keeps the POC's own scope deferral", async () => {
    const { ask } = scriptedAsk(
      conversation({ select: { scope: 'ambiguous' }, gates: GATES }),
    );
    const input = makeInput(makeRequest('do the thing'));
    const result = await selectWithGates(ask)(input, makeContext(input));
    expect(deferralOf(result)).toBe('jevSelect/scope_ambiguous');
  });

  test('defers grid mode before any call', async () => {
    const { ask, calls } = scriptedAsk(conversation({ gates: GATES }));
    const input = makeInput(makeRequest('hide it', { layoutMode: 'grid' }));
    const result = await selectWithGates(ask)(input, makeContext(input));
    expect(deferralOf(result)).toBe('jevSelect/grid_mode');
    expect(calls).toEqual([]);
  });
});

function withoutGates(value: object): object {
  const { gates: _gates, ...rest } = value as { gates?: unknown };
  return rest;
}
