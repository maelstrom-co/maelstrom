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
  spyLogger,
} from '../__test-helpers__/fixtures.js';
import { scriptedAsk } from '../__test-helpers__/scripted-fetch.js';
import { runPair } from '../__test-helpers__/stage-pair.js';
import type { Reply } from '../questions.js';
import { selectUngated } from '../stages-experimental/select-ungated.js';
import {
  GATE_THRESHOLD,
  NEEDS_ACTIONS_THRESHOLD,
  readGateAnswers,
  SELECTION_GATES,
  selectGated,
} from './select-gated.js';

const GATES = {
  'gate/needsActions': 0.9,
  'gate/generatedContent': 0.1,
  'gate/spatial': 0.25,
  'gate/dependsOnScreen': 0.2,
};

function pair(intent: string, script: Conversation) {
  const input = makeInput(makeRequest(intent));
  return runPair(
    selectUngated,
    selectGated,
    input,
    input,
    conversation(script),
  );
}

describe('selectGated', () => {
  test('records every gate answer with its probability and confidence', async () => {
    const { next } = await pair('set the weather to Oslo', { gates: GATES });
    expect(isOk(next.result) && next.result.value.gates).toEqual({
      needsActions: { answer: 'yes', probability: 0.9, confidence: 0.8 },
      generatedContent: { answer: 'no', probability: 0.1, confidence: 0.8 },
      spatial: { answer: 'no', probability: 0.25, confidence: 0.5 },
      dependsOnScreen: { answer: 'no', probability: 0.2, confidence: 0.6 },
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
      'gate/dependsOnScreen',
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
    const result = await selectGated(ask)(input, makeContext(input));
    expect(deferralOf(result)).toBe('jevSelect/scope_unsupported');
    expect(calls).toHaveLength(1);
  });

  test('defers a request that needs what a widget shows as screen content unavailable', async () => {
    const { ask } = scriptedAsk(
      conversation({ gates: { ...GATES, 'gate/dependsOnScreen': 0.8 } }),
    );
    const { logger, entries } = spyLogger();
    const input = makeInput(makeRequest('copy my tasks into the journal'));
    const result = await selectGated(ask)(
      input,
      makeContext(input, { logger }),
    );
    expect(deferralOf(result)).toBe('jevSelect/screen_content_unavailable');
    expect(entries).toContainEqual({
      level: 'info',
      msg: 'jev.defer',
      data: {
        stage: 'jevSelect',
        reason: 'jevSelect/screen_content_unavailable',
        question: 'gate/dependsOnScreen',
      },
    });
  });

  test('defers as unsupported when both generated content and screen content answer yes', async () => {
    const { ask } = scriptedAsk(
      conversation({
        gates: {
          ...GATES,
          'gate/generatedContent': 0.8,
          'gate/dependsOnScreen': 0.8,
        },
      }),
    );
    const input = makeInput(makeRequest('summarise the chart as a poem'));
    const result = await selectGated(ask)(input, makeContext(input));
    expect(deferralOf(result)).toBe('jevSelect/scope_unsupported');
  });

  test('returns the selection with all four gates when neither deferring gate answers yes', async () => {
    const { next } = await pair('add a task to buy milk', {
      gates: {
        ...GATES,
        'gate/generatedContent': 0.4,
        'gate/dependsOnScreen': 0.4,
      },
    });
    expect(isOk(next.result) && Object.keys(next.result.value.gates)).toEqual([
      'needsActions',
      'generatedContent',
      'spatial',
      'dependsOnScreen',
    ]);
  });

  test("counts a different view of a widget's data as needing an action", async () => {
    const { next } = await pair('show me the route', { gates: GATES });
    const [call] = next.calls;
    const question = call?.questions['gate/needsActions'] as
      | { readonly instructions?: string }
      | undefined;
    expect(question?.instructions).toContain('a different view of its data');
  });

  test("keeps the POC's own scope deferral", async () => {
    const { ask } = scriptedAsk(
      conversation({ select: { scope: 'ambiguous' }, gates: GATES }),
    );
    const input = makeInput(makeRequest('do the thing'));
    const result = await selectGated(ask)(input, makeContext(input));
    expect(deferralOf(result)).toBe('jevSelect/scope_ambiguous');
  });

  test('defers grid mode before any call', async () => {
    const { ask, calls } = scriptedAsk(conversation({ gates: GATES }));
    const input = makeInput(makeRequest('hide it', { layoutMode: 'grid' }));
    const result = await selectGated(ask)(input, makeContext(input));
    expect(deferralOf(result)).toBe('jevSelect/grid_mode');
    expect(calls).toEqual([]);
  });
});

describe('readGateAnswers', () => {
  const input = makeInput(makeRequest('set the weather to Oslo'));

  test('reads the same answers the stage records', async () => {
    const { next } = await pair('set the weather to Oslo', { gates: GATES });
    const result = readGateAnswers(gateReply(GATES), makeContext(input));
    expect(isOk(next.result)).toBe(true);
    expect(isOk(result) && result.value).toEqual(
      isOk(next.result) && next.result.value.gates,
    );
  });

  test('answers needsActions yes from a lower floor', () => {
    expect(NEEDS_ACTIONS_THRESHOLD).toBe(0.3);
    const below = readGateAnswers(
      gateReply({ ...GATES, 'gate/needsActions': 0.29 }),
      makeContext(input),
    );
    const at = readGateAnswers(
      gateReply({ ...GATES, 'gate/needsActions': 0.3 }),
      makeContext(input),
    );
    expect(isOk(below) && below.value.needsActions.answer).toBe('no');
    expect(isOk(at) && at.value.needsActions.answer).toBe('yes');
  });

  test.each([
    'generatedContent',
    'spatial',
    'dependsOnScreen',
  ] as const)('%s answers yes at the shared threshold and no just below it', (gate) => {
    expect(GATE_THRESHOLD).toBe(0.5);
    const below = readGateAnswers(
      gateReply({ ...GATES, [`gate/${gate}`]: 0.49 }),
      makeContext(input),
    );
    const at = readGateAnswers(
      gateReply({ ...GATES, [`gate/${gate}`]: 0.5 }),
      makeContext(input),
    );
    expect(isOk(below) && below.value[gate].answer).toBe('no');
    expect(isOk(at) && at.value[gate].answer).toBe('yes');
  });

  test('defers when a gate has no answer', () => {
    const { 'gate/spatial': _spatial, ...partial } = GATES;
    const result = readGateAnswers(gateReply(partial), makeContext(input));
    expect(deferralOf(result)).toBe('jevSelect/answer_missing');
  });

  test('names every gate the stage asks, in order', () => {
    expect(SELECTION_GATES).toEqual([
      'needsActions',
      'generatedContent',
      'spatial',
      'dependsOnScreen',
    ]);
  });
});

function gateReply(probabilities: Readonly<Record<string, number>>): Reply {
  return {
    answers: Object.fromEntries(
      Object.entries(probabilities).map(([id, probability]) => [
        id,
        {
          choice: probability >= 0.5 ? 'yes' : 'no',
          confidence: Math.abs(probability - 0.5) * 2,
          probability,
        },
      ]),
    ),
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

function withoutGates(value: object): object {
  const { gates: _gates, ...rest } = value as { gates?: unknown };
  return rest;
}
