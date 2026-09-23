import { afterEach, describe, expect, test } from 'bun:test';

import type { PlannerCandidate, ValidateCandidate } from '@maelstrom-co/engine';
import { err, isOk, MessageId, ok } from '@maelstrom-co/protocol';

import {
  acceptAll,
  deferralOf,
  errorTagOf,
  makeContext,
  makeRequest,
  plain,
  spyLogger,
} from '../__test-helpers__/fixtures.js';
import {
  completionPlan,
  planned,
} from '../__test-helpers__/layout-fixtures.js';
import {
  chatCall,
  chatPrompt,
  dummyAdapter,
  mockChat,
} from '../__test-helpers__/mock-chat.js';
import type { JevLayoutPlan, PendingParameter } from '../types.js';
import { completeLayoutInline } from './complete-layout-inline.js';
import { completeLayoutParallel } from './complete-layout-parallel.js';
import type { LayoutDecision } from './types.js';

afterEach(() => mockChat.mockReset());

const LOCATION: PendingParameter = {
  name: 'location',
  type: 'string',
  description: 'City or place to request weather for',
};

function decisionOf(
  layoutPlan: JevLayoutPlan,
  tree: LayoutDecision['tree'] = layoutPlan.tree,
): LayoutDecision {
  return {
    plan: { ...layoutPlan.plan, minConfidence: 1 },
    source: 'jev',
    ...(tree !== undefined && { layoutId: layoutPlan.layoutId, tree }),
    answers: [],
  };
}

function handOff(layoutPlan: JevLayoutPlan): LayoutDecision {
  const { layoutId: _layoutId, tree: _tree, ...rest } = decisionOf(layoutPlan);
  return rest;
}

async function run(
  decision: LayoutDecision,
  overrides: { validate?: ValidateCandidate; signal?: AbortSignal } = {},
) {
  return completeLayoutParallel({ adapter: dummyAdapter })(
    decision,
    makeContext(decision.plan.selection.input, overrides),
  );
}

const hidden = () =>
  completionPlan(makeRequest('hide the tasks'), {
    decisions: { 'tasks-main': 'hide' },
  });

describe('completeLayoutParallel', () => {
  test('with a tree, makes exactly one message-only call, equal to completeLayoutInline', async () => {
    const layoutPlan = completionPlan(
      makeRequest('weather for the capital of Japan'),
      {
        actions: [planned('weather-main/setLocation', {}, [LOCATION])],
      },
    );
    mockChat.mockResolvedValue({
      userMessage: 'Weather for Tokyo.',
      params: { p0: 'Tokyo' },
    });
    const inline = await completeLayoutInline({ adapter: dummyAdapter })(
      decisionOf(layoutPlan),
      makeContext(layoutPlan.plan.selection.input),
    );
    const parallel = await run(decisionOf(layoutPlan));
    expect(mockChat.mock.calls.length).toBe(2);
    expect(chatCall(1).messages).toEqual(chatCall(0).messages);
    expect(chatCall(1).systemPrompts).toEqual(chatCall(0).systemPrompts);
    expect(Object.keys(chatCall(1).outputSchema.shape)).toEqual(
      Object.keys(chatCall(0).outputSchema.shape),
    );
    expect(plain(parallel)).toEqual(plain(inline));
  });

  test('on a hand-off, assembles one candidate from the message call and the layout call', async () => {
    const tree = ['H', 'ID:weather-main', 'ID:calendar-main'];
    mockChat
      .mockResolvedValueOnce({ userMessage: 'Done.' })
      .mockResolvedValueOnce({ tree });
    const result = await run(handOff(hidden()));
    expect(Object.keys(chatCall(0).outputSchema.shape)).toEqual([
      'userMessage',
    ]);
    expect(Object.keys(chatCall(1).outputSchema.shape)).toEqual(['tree']);
    expect(chatPrompt(1)).toContain('## Layout to write');
    if (!isOk(result)) throw new Error(`deferred: ${deferralOf(result)}`);
    expect(plain(result.value.layout)).toMatchObject({ tree });
    expect(result.value.userMessage).toBe('Done.');
  });

  test('both calls start before either resolves', async () => {
    const pending: Array<() => void> = [];
    mockChat.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(() => resolve({ userMessage: 'Done.', tree: [] }));
        }),
    );
    const resultPromise = run(handOff(hidden()));
    expect(mockChat.mock.calls.length).toBe(2);
    for (const resolveCall of pending) resolveCall();
    await resultPromise;
  });

  test.each([
    ['leaves out a visible instance', ['ID:calendar-main']],
    [
      'places a hidden instance',
      ['V:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
    ],
    ['is malformed', ['V:1,1,1', 'ID:calendar-main']],
  ])('on a hand-off, defers invalid_layout when the tree %s', async (_name, tree) => {
    mockChat
      .mockResolvedValueOnce({ userMessage: 'Done.' })
      .mockResolvedValueOnce({ tree });
    const result = await run(handOff(hidden()));
    expect(deferralOf(result)).toBe('llmComplete/invalid_layout');
  });

  test('on a hand-off, defers invalid_layout when the layout call omits the tree', async () => {
    mockChat
      .mockResolvedValueOnce({ userMessage: 'Done.' })
      .mockResolvedValueOnce({});
    const result = await run(handOff(hidden()));
    expect(deferralOf(result)).toBe('llmComplete/invalid_layout');
  });

  test('a provider failure in the message call is a ProviderError, not a deferral', async () => {
    mockChat
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({ tree: [] });
    const result = await run(handOff(hidden()));
    expect(errorTagOf(result)).toBe('ProviderError');
  });

  test('a provider failure in the layout call is a ProviderError, not a deferral', async () => {
    mockChat
      .mockResolvedValueOnce({ userMessage: 'Done.' })
      .mockRejectedValueOnce(new Error('rate limited'));
    const result = await run(handOff(hidden()));
    expect(errorTagOf(result)).toBe('ProviderError');
  });

  test('an abort cancels both calls', async () => {
    const controller = new AbortController();
    const rejectors: Array<() => void> = [];
    mockChat.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectors.push(() =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const resultPromise = run(handOff(hidden()), { signal: controller.signal });
    expect(mockChat.mock.calls.length).toBe(2);
    controller.abort('user left');
    expect(chatCall(0).abortController.signal.aborted).toBe(true);
    expect(chatCall(1).abortController.signal.aborted).toBe(true);
    for (const reject of rejectors) reject();
    const result = await resultPromise;
    expect(errorTagOf(result)).toBe('CancellationError');
  });

  test.each([
    ['message', 0, 1],
    ['layout', 1, 0],
  ])('a failed %s call aborts the other and returns its own ProviderError', async (_name, failing, sibling) => {
    let started = 0;
    mockChat.mockImplementation((options) => {
      const index = started++;
      if (index === failing) return Promise.reject(new Error('rate limited'));
      return new Promise((_resolve, reject) => {
        options.abortController.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    });
    const result = await run(handOff(hidden()));
    expect(chatCall(sibling).abortController.signal.aborted).toBe(true);
    expect(errorTagOf(result)).toBe('ProviderError');
  });

  test('a null fill defers param_unfilled, naming the parameter', async () => {
    const layoutPlan = completionPlan(makeRequest('x'), {
      actions: [planned('weather-main/setLocation', {}, [LOCATION])],
    });
    mockChat
      .mockResolvedValueOnce({ userMessage: 'ok', params: { p0: null } })
      .mockResolvedValueOnce({ tree: [] });
    const { logger, entries } = spyLogger();
    const result = await completeLayoutParallel({ adapter: dummyAdapter })(
      decisionOf(layoutPlan),
      makeContext(layoutPlan.plan.selection.input, { logger }),
    );
    expect(deferralOf(result)).toBe('llmComplete/param_unfilled');
    expect(entries.find((e) => e.msg === 'jev.defer')?.data?.question).toBe(
      'weather-main/setLocation/location',
    );
  });

  test('a validation error defers invalid_candidate', async () => {
    const tree = ['H', 'ID:weather-main', 'ID:calendar-main'];
    mockChat
      .mockResolvedValueOnce({ userMessage: 'ok' })
      .mockResolvedValueOnce({ tree });
    const result = await run(handOff(hidden()), {
      validate: () =>
        err({ _tag: 'ParseError', message: 'empty userMessage', raw: '' }),
    });
    expect(deferralOf(result)).toBe('llmComplete/invalid_candidate');
  });

  test('a recommended retry defers retry_recommended', async () => {
    const tree = ['H', 'ID:weather-main', 'ID:calendar-main'];
    mockChat
      .mockResolvedValueOnce({ userMessage: 'ok' })
      .mockResolvedValueOnce({ tree });
    const recommending: ValidateCandidate = (candidate: PlannerCandidate) => {
      const report = acceptAll(candidate);
      if (!isOk(report)) return report;
      return ok({
        ...report.value,
        requestId: MessageId('req-1'),
        diagnostics: {
          ...report.value.diagnostics,
          retryHint: { severity: 'medium', recommend: true },
        },
      });
    };
    const result = await run(handOff(hidden()), { validate: recommending });
    expect(deferralOf(result)).toBe('llmComplete/retry_recommended');
  });
});
