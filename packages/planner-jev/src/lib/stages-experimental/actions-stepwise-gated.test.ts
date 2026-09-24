import { describe, expect, test } from 'bun:test';

import { isOk } from '@maelstrom-co/protocol';

import {
  type Conversation,
  conversation,
  keepAll,
} from '../__test-helpers__/actions-fixtures.js';
import {
  makeContext,
  makeRequest,
  makeResizeRequest,
  plain,
} from '../__test-helpers__/fixtures.js';
import {
  type Script,
  scriptedAsk,
} from '../__test-helpers__/scripted-fetch.js';
import type {
  ActionsStage,
  GateAnswer,
  Selection2,
} from '../stages/stage-types.js';
import type { Ask } from '../typesafe-client.js';
import { actionsStepwise } from './actions-stepwise.js';
import { actionsStepwiseGated } from './actions-stepwise-gated.js';

const TOKYO: Conversation = {
  actions: [
    {
      pick: 'weather-main/setLocation',
      params: { location: { value: 'Tokyo' } },
    },
  ],
};

const YES: GateAnswer = { answer: 'yes', probability: 0.9, confidence: 0.8 };
const NO: GateAnswer = { answer: 'no', probability: 0.2, confidence: 0.6 };

async function run(
  build: (ask: Ask) => ActionsStage,
  selection: Selection2,
  script: Script,
) {
  const { ask, calls } = scriptedAsk(script);
  const result = await build(ask)(selection, makeContext(selection.input));
  return { result, calls };
}

describe('actionsStepwiseGated', () => {
  test('makes no call and plans no actions when the gate answers no', async () => {
    const selection: Selection2 = {
      ...keepAll(makeRequest('put the map on the left')),
      gates: { needsActions: NO },
    };
    const { result, calls } = await run(
      actionsStepwiseGated,
      selection,
      conversation(TOKYO),
    );
    expect(calls).toEqual([]);
    expect(isOk(result) && plain(result.value.actions)).toEqual([]);
    expect(isOk(result) && plain(result.value.asks)).toEqual([]);
    expect(isOk(result) && result.value.answers).toEqual([]);
    expect(isOk(result) && result.value.minConfidence).toBe(1);
    expect(isOk(result) && result.value.gates).toEqual({ needsActions: NO });
  });

  test('makes no call on a resize-only turn', async () => {
    const { result, calls } = await run(
      actionsStepwiseGated,
      keepAll(makeResizeRequest(12, 20)),
      conversation({}),
    );
    expect(calls).toEqual([]);
    expect(isOk(result) && plain(result.value.actions)).toEqual([]);
  });

  test('plans the stepwise actions when the gate answers yes', async () => {
    const selection: Selection2 = {
      ...keepAll(makeRequest('show the weather in "Tokyo"')),
      gates: { needsActions: YES },
    };
    const gated = await run(
      actionsStepwiseGated,
      selection,
      conversation(TOKYO),
    );
    const control = await run(actionsStepwise, selection, conversation(TOKYO));
    expect(gated.calls).toEqual(control.calls);
    expect(plain(gated.result)).toEqual(plain(control.result));
    expect(isOk(gated.result) && plain(gated.result.value.actions)).toEqual([
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        params: { location: 'Tokyo' },
        pending: [],
      },
    ]);
  });

  test('plans the stepwise actions when the selection carries no gates', async () => {
    const selection = keepAll(makeRequest('show the weather in "Tokyo"'));
    const gated = await run(
      actionsStepwiseGated,
      selection,
      conversation(TOKYO),
    );
    const control = await run(actionsStepwise, selection, conversation(TOKYO));
    expect(gated.calls).toEqual(control.calls);
    expect(plain(gated.result)).toEqual(plain(control.result));
  });
});
