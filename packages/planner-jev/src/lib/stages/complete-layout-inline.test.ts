import { afterEach, describe, expect, test } from 'bun:test';

import type { PlannerCandidate, ValidateCandidate } from '@maelstrom-co/engine';
import {
  ActionName,
  type ChartRequest,
  err,
  InstanceId,
  isOk,
  MessageId,
  ok,
} from '@maelstrom-co/protocol';

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
  installMockChat,
  mockChat,
} from '../__test-helpers__/mock-chat.js';
import type {
  JevLayoutPlan,
  ParameterAsk,
  PendingParameter,
  PlannedAction,
} from '../types.js';
import { completeLayoutInline } from './complete-layout-inline.js';
import { llmComplete } from './llm-complete.js';
import type { LayoutDecision } from './stage-types.js';

installMockChat();

afterEach(() => mockChat.mockReset());

const LOCATION: PendingParameter = {
  name: 'location',
  type: 'string',
  description: 'City or place to request weather for',
};

const TITLE_ASK: ParameterAsk = {
  instanceId: InstanceId('tasks-main'),
  action: ActionName('addTask'),
  parameter: { name: 'title', type: 'string', description: 'Task title' },
};

const LOCATION_ASK: ParameterAsk = {
  instanceId: InstanceId('weather-main'),
  action: ActionName('setLocation'),
  parameter: LOCATION,
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
  return completeLayoutInline({ adapter: dummyAdapter })(
    decision,
    makeContext(decision.plan.selection.input, overrides),
  );
}

const hidden = () =>
  completionPlan(makeRequest('hide the tasks'), {
    decisions: { 'tasks-main': 'hide' },
  });

describe('completeLayoutInline', () => {
  test('disables TanStack console logs on layout hand-offs so provider errors use the engine logger', async () => {
    const tree = ['H', 'ID:weather-main', 'ID:calendar-main'];
    mockChat.mockResolvedValue({ userMessage: 'Done.', layout: { tree } });
    await run(handOff(hidden()));
    expect(chatCall().debug).toBe(false);
  });

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
    expect(Object.keys(nextCall.outputSchema.properties ?? {})).toEqual([
      'userMessage',
      'params',
    ]);
    expect(plain(next)).toEqual(plain(poc));
  });

  test('on a hand-off, asks for layout.tree and ships a tree that fits', async () => {
    const tree = ['H', 'ID:weather-main', 'ID:calendar-main'];
    mockChat.mockResolvedValue({ userMessage: 'Done.', layout: { tree } });
    const result = await run(handOff(hidden()));
    expect(Object.keys(chatCall().outputSchema.properties ?? {})).toEqual([
      'userMessage',
      'layout',
    ]);
    expect(chatPrompt()).toContain('## Layout to write');
    expect(chatPrompt()).toContain('- ID:weather-main (weather, current view');
    expect(chatPrompt()).not.toContain('ID:tasks-main (');
    if (!isOk(result)) throw new Error(`deferred: ${deferralOf(result)}`);
    if (result.value.type !== 'plan') throw new Error('expected a plan');
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
  ])(
    'on a hand-off, defers invalid_layout when the tree %s',
    async (_name, layout) => {
      mockChat.mockResolvedValue({
        userMessage: 'Done.',
        ...(layout && { layout }),
      });
      const result = await run(handOff(hidden()));
      expect(deferralOf(result)).toBe('llmComplete/invalid_layout');
    },
  );

  test('on a hand-off, rejects a missing layout before candidate validation', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Done.' });
    const result = await run(handOff(hidden()));
    expect(errorTagOf(result)).toBe('ProviderError');
  });

  test('on a hand-off, defers invalid_layout when a region is below its minimum size', async () => {
    mockChat.mockResolvedValue({
      userMessage: 'Done.',
      layout: { tree: ['V:50,1', 'ID:calendar-main', 'ID:weather-main'] },
    });
    const result = await run(handOff(hidden()));
    expect(deferralOf(result)).toBe('llmComplete/invalid_layout');
  });

  test('an action the simulated variant does not offer defers simulation_failed', async () => {
    mockChat.mockResolvedValue({ userMessage: 'ok' });
    const result = await run(
      decisionOf(
        completionPlan(makeRequest('x'), {
          actions: [planned('weather-main/openEntry')],
        }),
      ),
    );
    expect(deferralOf(result)).toBe('llmComplete/simulation_failed');
  });

  test('a validation error defers invalid_candidate', async () => {
    mockChat.mockResolvedValue({ userMessage: 'ok' });
    const result = await run(decisionOf(completionPlan(makeRequest('x'))), {
      validate: () =>
        err({ _tag: 'ParseError', message: 'empty userMessage', raw: '' }),
    });
    expect(deferralOf(result)).toBe('llmComplete/invalid_candidate');
  });

  test('a recommended retry defers retry_recommended', async () => {
    mockChat.mockResolvedValue({ userMessage: 'ok' });
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
    const result = await run(decisionOf(completionPlan(makeRequest('x'))), {
      validate: recommending,
    });
    expect(deferralOf(result)).toBe('llmComplete/retry_recommended');
  });

  test('a provider failure is a ProviderError, not a deferral', async () => {
    mockChat.mockRejectedValue(new Error('rate limited'));
    const result = await run(decisionOf(completionPlan(makeRequest('x'))));
    expect(errorTagOf(result)).toBe('ProviderError');
  });

  test('an abort is a CancellationError, not a deferral', async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    mockChat.mockImplementation(async (options) => {
      providerSignal = options.abortController.signal;
      controller.abort('user left');
      throw new DOMException('aborted', 'AbortError');
    });
    const result = await run(decisionOf(completionPlan(makeRequest('x'))), {
      signal: controller.signal,
    });
    expect(providerSignal?.aborted).toBe(true);
    expect(providerSignal?.reason).toBe('user left');
    expect(errorTagOf(result)).toBe('CancellationError');
  });

  test('a null fill defers param_unfilled, naming the parameter', async () => {
    mockChat.mockResolvedValue({ userMessage: 'ok', params: { p0: null } });
    const layoutPlan = completionPlan(makeRequest('x'), {
      actions: [planned('weather-main/setLocation', {}, [LOCATION])],
    });
    const { logger, entries } = spyLogger();
    const result = await completeLayoutInline({ adapter: dummyAdapter })(
      decisionOf(layoutPlan),
      makeContext(layoutPlan.plan.selection.input, { logger }),
    );
    expect(deferralOf(result)).toBe('llmComplete/param_unfilled');
    expect(entries.find((e) => e.msg === 'jev.defer')?.data?.question).toBe(
      'weather-main/setLocation/location',
    );
  });
});

describe('completeLayoutInline variants', () => {
  const journalWithWeather = () =>
    completionPlan(makeRequest('open the Monday entry'), {
      actions: [planned('journal-main/openEntry', { title: 'Monday' })],
      decisions: {
        'journal-main': 'keep',
        'calendar-main': 'hide',
        'tasks-main': 'hide',
      },
    });

  test('on a hand-off, the prompt sizes an instance in its post-action variant', async () => {
    const tree = ['H:2,1', 'ID:journal-main', 'ID:weather-main'];
    mockChat.mockResolvedValue({ userMessage: 'Opened it.', layout: { tree } });
    await run(handOff(journalWithWeather()));
    expect(chatPrompt()).toContain(
      '- ID:journal-main (journal, entry view, at least 16x12)',
    );
  });

  test('on a hand-off, defers invalid_layout when a region fits the pre-action variant but not the post-action one', async () => {
    mockChat.mockResolvedValue({
      userMessage: 'Opened it.',
      layout: { tree: ['H:1,1', 'ID:journal-main', 'ID:weather-main'] },
    });
    const result = await run(handOff(journalWithWeather()));
    expect(deferralOf(result)).toBe('llmComplete/invalid_layout');
  });

  test('on a hand-off, fits the tree on post-action variants and declares pre-action ones', async () => {
    const tree = ['H:2,1', 'ID:journal-main', 'ID:weather-main'];
    mockChat.mockResolvedValue({ userMessage: 'Opened it.', layout: { tree } });
    const result = await run(handOff(journalWithWeather()));
    if (!isOk(result)) throw new Error(`deferred: ${deferralOf(result)}`);
    expect(plain(result.value.layout)).toEqual({
      tree,
      instances: [
        { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
        { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
        { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
        { instanceId: 'map-main', vesselId: 'map', variant: 'overview' },
        { instanceId: 'journal-main', vesselId: 'journal', variant: 'list' },
      ],
    });
    expect(plain(result.value.executionPlan)).toEqual([
      {
        instanceId: 'journal-main',
        action: 'openEntry',
        paramsJson: '{"title":"Monday"}',
      },
    ]);
  });
});

describe('completeLayoutInline layout summary', () => {
  test('the prompt and rationale state the layout summary when the stage gives one', async () => {
    const layoutPlan = hidden();
    mockChat.mockResolvedValue({ userMessage: 'Done.', params: {} });
    const result = await run({
      ...decisionOf(layoutPlan),
      layoutSummary: 'changed. Before: a on the left. Now: b on the left',
    });
    expect(chatPrompt()).toContain(
      '- Layout: changed. Before: a on the left. Now: b on the left',
    );
    if (!isOk(result)) throw new Error(`deferred: ${deferralOf(result)}`);
    if (result.value.type !== 'plan') throw new Error('expected a plan');
    expect(result.value.rationale).toContain(
      'Layout: changed. Before: a on the left. Now: b on the left',
    );
  });
});

describe('completeLayoutInline repeated actions', () => {
  const TITLE: PendingParameter = {
    name: 'title',
    type: 'string',
    description: 'Task title',
  };

  async function runLogged(
    actions: readonly PlannedAction[],
    params: Record<string, unknown>,
  ) {
    const layoutPlan = completionPlan(makeRequest('add buy milk'), { actions });
    mockChat.mockResolvedValue({ userMessage: 'Added.', params });
    const { logger, entries } = spyLogger();
    const result = await completeLayoutInline({ adapter: dummyAdapter })(
      decisionOf(layoutPlan),
      makeContext(layoutPlan.plan.selection.input, { logger }),
    );
    if (!isOk(result)) throw new Error(`deferred: ${deferralOf(result)}`);
    return {
      steps: plain(result.value.executionPlan),
      layout: plain(result.value.layout),
      dropped: entries.filter((e) => e.msg === 'jev.duplicate_action_dropped'),
    };
  }

  test('drops a pending action that fills to the value of an earlier bound one', async () => {
    const { steps, dropped } = await runLogged(
      [
        planned('tasks-main/addTask', { title: 'Buy milk' }, []),
        planned('tasks-main/addTask', {}, [TITLE]),
      ],
      { p0: 'Buy milk' },
    );
    expect(steps).toEqual([
      {
        instanceId: 'tasks-main',
        action: 'addTask',
        paramsJson: '{"title":"Buy milk"}',
      },
    ]);
    expect(dropped).toHaveLength(1);
  });

  test('declares calendar-main in its pre-action variant after dropping repeats', async () => {
    const { steps, layout } = await runLogged(
      [
        planned('calendar-main/showWeek'),
        planned('calendar-main/showMonth'),
        planned('calendar-main/showWeek'),
      ],
      {},
    );
    expect(steps).toEqual([
      expect.objectContaining({ action: 'showWeek' }),
      expect.objectContaining({ action: 'showMonth' }),
    ]);
    expect(layout).toMatchObject({
      instances: expect.arrayContaining([
        expect.objectContaining({
          instanceId: 'calendar-main',
          variant: 'month',
        }),
      ]),
    });
  });

  test('drops a later action whose filled parameters equal an earlier one', async () => {
    const { steps, dropped } = await runLogged(
      [
        planned('tasks-main/addTask', {}, [TITLE]),
        planned('tasks-main/addTask', {}, [TITLE]),
      ],
      { p0: 'Buy milk', p1: 'Buy milk' },
    );
    expect(steps).toEqual([
      {
        instanceId: 'tasks-main',
        action: 'addTask',
        paramsJson: '{"title":"Buy milk"}',
      },
    ]);
    expect(dropped.map((entry) => entry.data)).toEqual([
      expect.objectContaining({
        instanceId: 'tasks-main',
        action: 'addTask',
        params: { title: 'Buy milk' },
      }),
    ]);
  });

  test('keeps both actions when the filled values differ', async () => {
    const { steps, dropped } = await runLogged(
      [
        planned('tasks-main/addTask', {}, [TITLE]),
        planned('tasks-main/addTask', {}, [TITLE]),
      ],
      { p0: 'Buy milk', p1: 'Send invoice' },
    );
    expect(steps).toHaveLength(2);
    expect(dropped).toEqual([]);
  });

  test('keeps both actions when one has an extra parameter', async () => {
    const { steps, dropped } = await runLogged(
      [
        planned('tasks-main/addTask', {}, [TITLE]),
        planned('tasks-main/addTask', { urgent: true }, [TITLE]),
      ],
      { p0: 'Buy milk', p1: 'Buy milk' },
    );
    expect(steps).toHaveLength(2);
    expect(dropped).toEqual([]);
  });
});

describe('completeLayoutInline with skipReply', () => {
  test('with a tree and no pending slots makes no call and ships no userMessage', async () => {
    const result = await run(
      decisionOf(
        completionPlan(skipping(makeRequest('hide the tasks'), true), {
          decisions: { 'tasks-main': 'hide' },
        }),
      ),
    );
    expect(mockChat.mock.calls.length).toBe(0);
    if (!isOk(result)) throw new Error(`deferred: ${deferralOf(result)}`);
    expect(plain(result.value)).not.toHaveProperty('userMessage');
  });

  test('on a hand-off asks for layout.tree without a reply and ships that tree', async () => {
    const tree = ['H', 'ID:weather-main', 'ID:calendar-main'];
    mockChat.mockResolvedValue({ layout: { tree } });
    const result = await run(
      handOff(
        completionPlan(skipping(makeRequest('hide the tasks'), true), {
          decisions: { 'tasks-main': 'hide' },
        }),
      ),
    );
    expect(mockChat.mock.calls.length).toBe(1);
    expect(Object.keys(chatCall().outputSchema.properties ?? {})).toEqual([
      'layout',
    ]);
    expect(chatCall().systemPrompts.join('\n')).toContain('do not write one');
    expect(chatPrompt()).toContain('## Layout to write');
    if (!isOk(result)) throw new Error(`deferred: ${deferralOf(result)}`);
    expect(plain(result.value)).not.toHaveProperty('userMessage');
    expect(plain(result.value.layout)).toMatchObject({ tree });
  });

  test('with a tree and a pending slot fills it without asking for a reply', async () => {
    mockChat.mockResolvedValue({ params: { p0: 'Tokyo' } });
    const result = await run(
      decisionOf(
        completionPlan(
          skipping(makeRequest('weather for the capital of Japan'), true),
          { actions: [planned('weather-main/setLocation', {}, [LOCATION])] },
        ),
      ),
    );
    expect(mockChat.mock.calls.length).toBe(1);
    expect(Object.keys(chatCall().outputSchema.properties ?? {})).toEqual([
      'params',
    ]);
    expect(chatPrompt()).not.toMatch(/reply/i);
    if (!isOk(result)) throw new Error(`deferred: ${deferralOf(result)}`);
    expect(plain(result.value)).not.toHaveProperty('userMessage');
    expect(plain(result.value.executionPlan)).toEqual([
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        paramsJson: '{"location":"Tokyo"}',
      },
    ]);
  });

  test('false behaves exactly like an absent flag', async () => {
    mockChat.mockResolvedValue({ userMessage: 'ok', params: { p0: 'Tokyo' } });
    const decision = (request: ChartRequest) =>
      decisionOf(
        completionPlan(request, {
          actions: [planned('weather-main/setLocation', {}, [LOCATION])],
        }),
      );
    const absent = await run(decision(makeRequest('weather for Tokyo')));
    const explicit = await run(
      decision(skipping(makeRequest('weather for Tokyo'), false)),
    );
    expect(plain(explicit)).toEqual(plain(absent));
    if (!isOk(explicit)) throw new Error(`deferred: ${deferralOf(explicit)}`);
    if (explicit.value.type !== 'plan') throw new Error('expected a plan');
    expect(explicit.value.userMessage).toBe('ok');
    expect(Object.keys(chatCall(1).outputSchema.properties ?? {})).toEqual([
      'userMessage',
      'params',
    ]);
    expect(chatCall(1).outputSchema).toEqual(chatCall(0).outputSchema);
    expect(chatCall(1).systemPrompts).toEqual(chatCall(0).systemPrompts);
    expect(chatPrompt(1)).toBe(chatPrompt(0));
  });
});

describe('completeLayoutInline with skipReply and asks', () => {
  test('with a tree ships the partial plan as a needs-clarification result without a call', async () => {
    const result = await run(
      decisionOf(
        completionPlan(
          skipping(
            makeRequest('add a task and show the weekly forecast'),
            true,
          ),
          { actions: [planned('weather-main/showWeekly')], asks: [TITLE_ASK] },
        ),
      ),
    );
    expect(mockChat.mock.calls.length).toBe(0);
    const clarification = clarificationOf(result);
    expect(clarification.type).toBe('needs_clarification');
    expect(clarification.question).toContain('title');
    expect(clarification.executionPlan).toEqual([
      { instanceId: 'weather-main', action: 'showWeekly' },
    ]);
    expect(clarification).not.toHaveProperty('userMessage');
  });

  test('on a hand-off writes the tree without a reply and ships it in the clarification', async () => {
    const tree = ['H', 'ID:weather-main', 'ID:calendar-main'];
    mockChat.mockResolvedValue({ layout: { tree } });
    const result = await run(
      handOff(
        completionPlan(
          skipping(makeRequest('hide the tasks and set the weather'), true),
          { decisions: { 'tasks-main': 'hide' }, asks: [LOCATION_ASK] },
        ),
      ),
    );
    expect(mockChat.mock.calls.length).toBe(1);
    expect(Object.keys(chatCall().outputSchema.properties ?? {})).toEqual([
      'layout',
    ]);
    expect(chatPrompt()).not.toContain('## Ask the user');
    const clarification = clarificationOf(result);
    expect(clarification.type).toBe('needs_clarification');
    expect(clarification.layout?.tree).toEqual(tree);
    expect(clarification).not.toHaveProperty('userMessage');
  });
});

describe('completeLayoutInline asks without skipReply', () => {
  test('the prompt asks the user and the reply comes from the call', async () => {
    mockChat.mockResolvedValue({ userMessage: 'What should the task say?' });
    const result = await run(
      decisionOf(
        completionPlan(makeRequest('add a task and show the weekly forecast'), {
          actions: [planned('weather-main/showWeekly')],
          asks: [TITLE_ASK],
        }),
      ),
    );
    expect(chatPrompt()).toContain('## Ask the user');
    const candidate = plain(
      isOk(result) ? result.value : deferralOf(result),
    ) as { type: string; userMessage: string };
    expect(candidate.type).toBe('plan');
    expect(candidate.userMessage).toBe('What should the task say?');
  });
});

function clarificationOf(result: Awaited<ReturnType<typeof run>>) {
  if (!isOk(result))
    throw new Error(`expected a result: ${deferralOf(result)}`);
  return plain(result.value) as {
    type: string;
    question?: string;
    layout?: { tree: unknown[] };
    executionPlan?: {
      instanceId: string;
      action: string;
      paramsJson?: string;
    }[];
  };
}

function skipping(request: ChartRequest, skipReply: boolean): ChartRequest {
  return { ...request, skipReply };
}
