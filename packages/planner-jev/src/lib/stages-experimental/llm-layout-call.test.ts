import { afterEach, describe, expect, test } from 'bun:test';

import { isOk } from '@maelstrom-co/protocol';

import {
  makeContext,
  makeRequest,
  plain,
} from '../__test-helpers__/fixtures.js';
import { completionPlan } from '../__test-helpers__/layout-fixtures.js';
import {
  chatCall,
  chatPrompt,
  dummyAdapter,
  installMockChat,
  mockChat,
} from '../__test-helpers__/mock-chat.js';
import { prepareCompletion } from '../stages/complete-layout-inline.js';
import type { LayoutDecision } from '../stages/stage-types.js';
import { llmLayoutCall } from './llm-layout-call.js';

installMockChat();

afterEach(() => mockChat.mockReset());

function handOff(): LayoutDecision {
  const layoutPlan = completionPlan(makeRequest('put weather next to tasks'), {
    decisions: { 'calendar-main': 'hide' },
  });
  const {
    layoutId: _layoutId,
    tree: _tree,
    ...rest
  } = {
    plan: { ...layoutPlan.plan, minConfidence: 1 },
    source: 'jev' as const,
    layoutId: layoutPlan.layoutId,
    tree: layoutPlan.tree,
    answers: [],
  };
  return rest;
}

describe('llmLayoutCall', () => {
  test('asks for the tree only, over the visible instances', async () => {
    const decision = handOff();
    const { visible } = prepareCompletion(decision);
    mockChat.mockResolvedValue({
      tree: ['H', 'ID:weather-main', 'ID:tasks-main'],
    });
    const result = await llmLayoutCall(
      { adapter: dummyAdapter },
      decision,
      visible,
      makeContext(decision.plan.selection.input),
    );
    expect(Object.keys(chatCall().outputSchema.shape)).toEqual(['tree']);
    expect(chatPrompt()).toContain('## Layout to write');
    expect(chatPrompt()).toContain('- ID:weather-main (weather, current view');
    expect(chatPrompt()).not.toContain('ID:calendar-main (');
    if (!isOk(result)) throw new Error('expected ok result');
    expect(plain(result.value)).toEqual({
      tree: ['H', 'ID:weather-main', 'ID:tasks-main'],
    });
  });

  test('describes the split axes as side by side and stacked, never row/column or left/right/top/bottom', async () => {
    const decision = handOff();
    const { visible } = prepareCompletion(decision);
    mockChat.mockResolvedValue({ tree: ['ID:weather-main'] });
    await llmLayoutCall(
      { adapter: dummyAdapter },
      decision,
      visible,
      makeContext(decision.plan.selection.input),
    );
    const prompt = chatPrompt();
    expect(prompt).toContain('side by side');
    expect(prompt).toContain('stacked');
    // "columns"/"rows" describe the Chart's own dimensions, not the split
    // axes, so only the directional and row/column-as-axis words are banned.
    for (const banned of ['left', 'right', 'top', 'bottom'])
      expect(prompt.toLowerCase()).not.toContain(banned);
  });

  test('includes the current layout and Chart dimensions', async () => {
    const decision = handOff();
    const { visible } = prepareCompletion(decision);
    mockChat.mockResolvedValue({ tree: ['ID:weather-main'] });
    await llmLayoutCall(
      { adapter: dummyAdapter },
      decision,
      visible,
      makeContext(decision.plan.selection.input),
    );
    const prompt = chatPrompt();
    expect(prompt).toContain('30 columns by 18 rows');
    expect(prompt).toContain('Current layout:');
  });

  test('includes the request intent', async () => {
    const decision = handOff();
    const { visible } = prepareCompletion(decision);
    mockChat.mockResolvedValue({ tree: ['ID:weather-main'] });
    await llmLayoutCall(
      { adapter: dummyAdapter },
      decision,
      visible,
      makeContext(decision.plan.selection.input),
    );
    expect(chatPrompt()).toContain('put weather next to tasks');
  });
});
