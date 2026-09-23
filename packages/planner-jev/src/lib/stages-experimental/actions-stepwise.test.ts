import { describe, expect, test } from 'bun:test';

import { type ChartRequest, isOk } from '@maelstrom-co/protocol';

import {
  type Conversation,
  conversation,
  keepAll,
} from '../__test-helpers__/actions-fixtures.js';
import {
  makeRequest,
  makeResizeRequest,
} from '../__test-helpers__/fixtures.js';
import { runPair } from '../__test-helpers__/stage-pair.js';
import { jevActions } from '../stages/jev-actions.js';
import { actionsStepwise } from './actions-stepwise.js';
import type { GateAnswer, Selection2 } from './types.js';

const TOKYO: Conversation = {
  actions: [
    {
      pick: 'weather-main/setLocation',
      params: { location: { value: 'Tokyo' } },
    },
  ],
  confidence: 0.65,
};

function pair(selection: Selection2, script: Conversation) {
  return runPair(
    jevActions,
    actionsStepwise,
    selection,
    selection.input,
    conversation(script),
  );
}

function selectionOf(request: ChartRequest): Selection2 {
  return keepAll(request);
}

describe('actionsStepwise', () => {
  test('sends the POC action calls and adds the lowest answer confidence', async () => {
    const { poc, next } = await pair(
      selectionOf(makeRequest('show the weather in Tokyo')),
      TOKYO,
    );
    expect(next.calls).toEqual(poc.calls);
    expect(next.plain).toEqual({
      ...(poc.result as { value: object }),
      value: {
        ...(poc.result as { value: object }).value,
        minConfidence: 0.65,
      },
    });
  });

  test('forwards the selection gates unchanged', async () => {
    const needsActions: GateAnswer = {
      answer: 'yes',
      probability: 0.9,
      confidence: 0.8,
    };
    const selection: Selection2 = {
      ...selectionOf(makeRequest('show the weather in Tokyo')),
      gates: { needsActions },
    };
    const { next } = await pair(selection, TOKYO);
    expect(isOk(next.result) && next.result.value.gates).toEqual({
      needsActions,
    });
    expect(isOk(next.result) && next.result.value.selection).toBe(selection);
  });

  test('reports full confidence when it asked nothing', async () => {
    const { poc, next } = await pair(
      selectionOf(makeResizeRequest(12, 20)),
      {},
    );
    expect(next.calls).toEqual([]);
    expect(poc.calls).toEqual([]);
    expect(isOk(next.result) && next.result.value.minConfidence).toBe(1);
    expect(isOk(next.result) && 'gates' in next.result.value).toBe(false);
  });
});
