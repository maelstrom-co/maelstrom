import { afterEach, describe, expect, test } from 'bun:test';

import { isOk } from '@maelstrom-co/protocol';

import {
  deferralOf,
  makeContext,
  makeRequest,
  plain,
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
import { llmComplete } from '../stages/llm-complete.js';
import type { JevLayoutPlan, PendingParameter } from '../types.js';
import { completeWithLayout } from './complete.js';
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

async function run(decision: LayoutDecision) {
  return completeWithLayout({ adapter: dummyAdapter })(
    decision,
    makeContext(decision.plan.selection.input),
  );
}

const hidden = () =>
  completionPlan(makeRequest('hide the tasks'), {
    decisions: { 'tasks-main': 'hide' },
  });

describe('completeWithLayout', () => {
  test('with a tree, sends the llmComplete call and ships its candidate', async () => {
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
    const poc = await llmComplete({ adapter: dummyAdapter })(
      layoutPlan,
      makeContext(layoutPlan.plan.selection.input),
    );
    const next = await run(decisionOf(layoutPlan));
    const [pocCall, nextCall] = [chatCall(0), chatCall(1)];
    expect(nextCall.messages).toEqual(pocCall.messages);
    expect(nextCall.systemPrompts).toEqual(pocCall.systemPrompts);
    expect(Object.keys(nextCall.outputSchema.shape)).toEqual([
      'userMessage',
      'params',
    ]);
    expect(plain(next)).toEqual(plain(poc));
  });

  test('on a hand-off, asks for layout.tree and ships a tree that fits', async () => {
    const tree = ['H', 'ID:weather-main', 'ID:calendar-main'];
    mockChat.mockResolvedValue({ userMessage: 'Done.', layout: { tree } });
    const result = await run(handOff(hidden()));
    expect(Object.keys(chatCall().outputSchema.shape)).toEqual([
      'userMessage',
      'layout',
    ]);
    expect(chatPrompt()).toContain('## Layout to write');
    expect(chatPrompt()).toContain('- ID:weather-main (weather, current view');
    expect(chatPrompt()).not.toContain('ID:tasks-main (');
    if (!isOk(result)) throw new Error(`deferred: ${deferralOf(result)}`);
    expect(plain(result.value.layout)).toMatchObject({ tree });
    expect(result.value.rationale).toContain('Layout: written by the LLM');
  });

  test.each([
    ['leaves out a visible instance', { tree: ['ID:calendar-main'] }],
    [
      'places a hidden instance',
      {
        tree: [
          'V:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
      },
    ],
    ['is malformed', { tree: ['V:1,1,1', 'ID:calendar-main'] }],
    ['is missing', undefined],
  ])('on a hand-off, defers invalid_layout when the tree %s', async (_name, layout) => {
    mockChat.mockResolvedValue({
      userMessage: 'Done.',
      ...(layout && { layout }),
    });
    const result = await run(handOff(hidden()));
    expect(deferralOf(result)).toBe('llmComplete/invalid_layout');
  });

  test('on a hand-off, defers invalid_layout when a region is below its minimum size', async () => {
    mockChat.mockResolvedValue({
      userMessage: 'Done.',
      layout: { tree: ['V:50,1', 'ID:calendar-main', 'ID:weather-main'] },
    });
    const result = await run(handOff(hidden()));
    expect(deferralOf(result)).toBe('llmComplete/invalid_layout');
  });
});
