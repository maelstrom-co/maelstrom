import { afterEach, describe, expect, test } from 'bun:test';

import {
  createEngine,
  type PlannerCandidate,
  type PlanningInput,
  type Retryable,
  type Stage,
} from '@maelstrom-co/engine';
import {
  type ChartRequest,
  ChartRequestMessage,
  isErr,
  isOk,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';

import {
  type Conversation,
  conversation,
} from './__test-helpers__/actions-fixtures.js';
import {
  makeRequest,
  makeResizeRequest,
  plain,
  spyLogger,
} from './__test-helpers__/fixtures.js';
import {
  dummyAdapter,
  installMockChat,
  mockChat,
} from './__test-helpers__/mock-chat.js';
import { fallbackCandidate } from './__test-helpers__/poc-fixtures.js';
import {
  type Script,
  scriptedFetch,
  TEST_MODEL,
} from './__test-helpers__/scripted-fetch.js';
import { jevPlanner } from './jev-planner.js';

installMockChat();

afterEach(() => mockChat.mockReset());

/** Healing drops the orphan leaf and empties the layout: an unrecoverable retry. */
function retryTriggering(request: ChartRequest, userMessage: string) {
  return fallbackCandidate(request, { tree: ['ID:ghost'], userMessage });
}

function scriptedFallback(
  answer: (request: ChartRequest, call: number) => PlannerCandidate,
) {
  const inputs: Retryable<PlanningInput>[] = [];
  const stage: Stage<Retryable<PlanningInput>, PlannerCandidate> = async (
    input,
  ) => {
    inputs.push(input);
    return ok(answer(input.request, inputs.length));
  };
  return { stage, inputs };
}

async function run(
  request: ChartRequest,
  script: Script,
  options: {
    readonly fallback?: ReturnType<typeof scriptedFallback>;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  } = {},
) {
  const { fetch, calls } = scriptedFetch(script);
  const fallback =
    options.fallback ?? scriptedFallback((r) => fallbackCandidate(r));
  const { logger, entries } = spyLogger();
  const engine = createEngine({
    planner: jevPlanner({
      typesafe: {
        apiKey: 'typesafe-test-key',
        model: TEST_MODEL,
        fetch,
        timeoutMs: options.timeoutMs ?? 1000,
      },
      adapter: dummyAdapter,
      fallback: fallback.stage,
    }),
    retry: false,
    logger,
  });
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId: SessionId('jev'),
      id: MessageId('turn-1'),
      request,
    }),
    options.signal,
  );
  return { result, calls, fallback, entries };
}

function shipped(result: Awaited<ReturnType<typeof run>>['result']) {
  if (!isOk(result) || result.value.type !== 'chart_response')
    throw new Error(`expected a chart response: ${JSON.stringify(result)}`);
  return plain(result.value.response) as {
    userMessage: string;
    rationale: string;
    executionPlan: {
      instanceId: string;
      action: string;
      params?: Record<string, unknown>;
    }[];
    layout: {
      tree: unknown[];
      instances: { instanceId: string; variant: string }[];
    };
  };
}

const talk = (script: Conversation) => conversation(script);

describe('jevPlanner through createEngine', () => {
  test('asks the screen scope select, then the POC actions and layout', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Tasks are hidden.' });
    const { calls } = await run(
      makeRequest('hide the tasks'),
      talk({
        select: { 'view/tasks-main': 'hide' },
        gates: { 'hide/tasks-main': 0.9 },
        layout: 'row',
      }),
    );
    expect(calls.map((call) => Object.keys(call.questions).sort())).toEqual([
      [
        'gate/dependsOnScreen',
        'gate/generatedContent',
        'gate/needsActions',
        'gate/spatial',
        'hide/calendar-main',
        'hide/tasks-main',
        'hide/weather-main',
        'new/calendar',
        'new/journal',
        'new/map',
        'new/tasks',
        'new/weather',
        'scope',
        'screen',
        'view/calendar-main',
        'view/journal-main',
        'view/map-main',
        'view/tasks-main',
        'view/weather-main',
      ],
      ['action/0'],
      ['layout'],
    ]);
  });

  test('keeps a visible instance the request does not hide when the screen is adjusted', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Tasks are hidden.' });
    const { result, fallback } = await run(
      makeRequest('hide the tasks'),
      talk({ select: { 'view/tasks-main': 'hide' }, layout: 'row' }),
    );
    expect(shipped(result).layout.tree).toContain('ID:tasks-main');
    expect(fallback.inputs).toHaveLength(0);
  });

  test('a hide request ships Jev’s selection with the mocked message', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Tasks are hidden.' });
    const { result, fallback, calls } = await run(
      makeRequest('hide the tasks'),
      talk({
        select: { 'view/tasks-main': 'hide' },
        gates: { 'hide/tasks-main': 0.9 },
        layout: 'row',
      }),
    );
    const response = shipped(result);
    expect(response.userMessage).toBe('Tasks are hidden.');
    expect(response.layout.tree).toEqual([
      'V',
      'ID:calendar-main',
      'ID:weather-main',
    ]);
    expect(response.layout.instances.map((i) => i.instanceId)).toContain(
      'tasks-main',
    );
    expect(response.executionPlan).toEqual([]);
    expect(fallback.inputs).toHaveLength(0);
    expect(calls).toHaveLength(3);
  });

  test('"show the weather in Tokyo" ships setLocation bound by Jev', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Showing Tokyo.' });
    const { result, fallback } = await run(
      makeRequest('show the weather in Tokyo'),
      talk({
        actions: [
          {
            pick: 'weather-main/setLocation',
            params: { location: { value: 'Tokyo' } },
          },
        ],
        layout: 'preserve',
      }),
    );
    expect(shipped(result).executionPlan).toEqual([
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        params: { location: 'Tokyo' },
      },
    ]);
    expect(fallback.inputs).toHaveLength(0);
  });

  test('a stated_elsewhere value ships the LLM fill', async () => {
    mockChat.mockResolvedValue({
      userMessage: 'Weather for Tokyo.',
      params: { p0: 'Tokyo' },
    });
    const { result } = await run(
      makeRequest('weather for the capital of Japan'),
      talk({
        actions: [
          {
            pick: 'weather-main/setLocation',
            params: { location: 'stated_elsewhere' },
          },
        ],
        layout: 'preserve',
      }),
    );
    expect(shipped(result).executionPlan).toEqual([
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        params: { location: 'Tokyo' },
      },
    ]);
  });

  test('a not_stated value ships the other actions and not the dropped one', async () => {
    mockChat.mockResolvedValue({
      userMessage: 'Weekly forecast is up. What should the task say?',
    });
    const { result, fallback } = await run(
      makeRequest('add a task and show the weekly forecast'),
      talk({
        actions: [
          {
            pick: 'tasks-main/addTask',
            params: { title: 'not_stated', urgent: 'omit' },
          },
          { pick: 'weather-main/showWeekly' },
        ],
        layout: 'preserve',
      }),
    );
    const response = shipped(result);
    expect(response.executionPlan).toEqual([
      { instanceId: 'weather-main', action: 'showWeekly' },
    ]);
    expect(response.userMessage).toContain('What should the task say?');
    expect(fallback.inputs).toHaveLength(0);
  });

  test('a null fill reaches the fallback', async () => {
    mockChat.mockResolvedValue({ userMessage: 'x', params: { p0: null } });
    const { result, fallback, entries } = await run(
      makeRequest('weather for the capital of Japan'),
      talk({
        actions: [
          {
            pick: 'weather-main/setLocation',
            params: { location: 'stated_elsewhere' },
          },
        ],
        layout: 'preserve',
      }),
    );
    expect(shipped(result).userMessage).toBe('from the fallback');
    expect(fallback.inputs).toHaveLength(1);
    expect(
      entries.find((e) => e.msg === 'Planner stage deferred, running fallback')
        ?.data?.reason,
    ).toBe('llmComplete/param_unfilled');
  });

  test('a transition to a larger variant ships the post-transition variant and the action', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Opened Monday.' });
    const request = makeRequest('open the journal entry "Monday"');
    const { result, calls, fallback } = await run(
      request,
      talk({
        select: { 'view/journal-main': 'keep' },
        actions: [
          {
            pick: 'journal-main/openEntry',
            params: { title: { value: 'Monday' } },
          },
        ],
        layout: 'focus/V/journal-main',
      }),
    );
    const layoutCall = calls.find((call) => 'layout' in call.questions);
    expect(
      Object.keys(layoutCall?.questions.layout?.criteria ?? {}),
    ).not.toContain('row');
    const response = shipped(result);
    expect(fallback.inputs).toHaveLength(0);
    expect(
      response.layout.instances.find((i) => i.instanceId === 'journal-main')
        ?.variant,
    ).toBe('entry');
    expect(response.executionPlan).toEqual([
      {
        instanceId: 'journal-main',
        action: 'openEntry',
        params: { title: 'Monday' },
      },
    ]);
    expect(response.layout.tree).toEqual([
      'V:2,1',
      'ID:journal-main',
      'H:1,1,1',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
  });

  test('a new map with a route ships in the route variant with showRoute', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Added a map with the route.' });
    const request = makeRequest(
      'show me a map with a route to Central Station',
    );
    const { result, fallback } = await run(
      request,
      talk({
        select: { 'new/map': 'one/overview' },
        actions: [
          {
            pick: 'map-jev-1/showRoute',
            params: { destination: { value: 'Central Station' } },
          },
        ],
        layout: (payload) =>
          Object.keys(payload.questions.layout?.criteria ?? {})[0] ?? '',
      }),
    );
    const response = shipped(result);
    expect(fallback.inputs).toHaveLength(0);
    expect(
      response.layout.instances.find((i) => i.instanceId === 'map-jev-1')
        ?.variant,
    ).toBe('route');
    expect(response.executionPlan).toEqual([
      {
        instanceId: 'map-jev-1',
        action: 'showRoute',
        params: { destination: 'Central Station' },
      },
    ]);
  });

  test('a new calendar switched to week ships in the week variant without the switch', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Added a week calendar.' });
    const request = makeRequest('add another calendar showing this week');
    const { result, fallback } = await run(
      request,
      talk({
        select: { 'new/calendar': 'one/month' },
        actions: [{ pick: 'calendar-jev-1/showWeek' }],
        layout: (payload) =>
          Object.keys(payload.questions.layout?.criteria ?? {})[0] ?? '',
      }),
    );
    const response = shipped(result);
    expect(fallback.inputs).toHaveLength(0);
    expect(
      response.layout.instances.find((i) => i.instanceId === 'calendar-jev-1')
        ?.variant,
    ).toBe('week');
    expect(response.executionPlan).toEqual([]);
  });

  test('a provider timeout reaches the fallback', async () => {
    const { result, fallback, entries } = await run(
      makeRequest('hide the tasks'),
      () => 'hang',
      { timeoutMs: 20 },
    );
    expect(shipped(result).userMessage).toBe('from the fallback');
    expect(fallback.inputs).toHaveLength(1);
    expect(
      entries.find((e) => e.msg === 'Planner stage deferred, running fallback')
        ?.data?.reason,
    ).toBe('jevSelect/provider_timeout');
  });

  test('a cancelled request returns CancellationError without the fallback', async () => {
    const controller = new AbortController();
    const pending = run(makeRequest('hide the tasks'), () => 'hang', {
      signal: controller.signal,
      timeoutMs: 5000,
    });
    await Bun.sleep(10);
    controller.abort('user left');
    const { result, fallback } = await pending;
    expect(isErr(result) && result.error._tag).toBe('CancellationError');
    expect(fallback.inputs).toHaveLength(0);
  });

  test('the Jev pipeline runs once when its candidate recommends a retry, then falls back', async () => {
    mockChat.mockResolvedValue({ userMessage: 'x', params: { p0: 'many' } });
    const { result, calls, fallback, entries } = await run(
      makeRequest('show as many tasks as fit'),
      talk({
        actions: [
          {
            pick: 'tasks-main/setLimit',
            params: { count: 'stated_elsewhere' },
          },
        ],
        layout: 'preserve',
      }),
    );
    expect(shipped(result).userMessage).toBe('from the fallback');
    expect(calls.filter((call) => 'scope' in call.questions)).toHaveLength(1);
    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(fallback.inputs).toHaveLength(1);
    expect(
      entries.find((e) => e.msg === 'Planner stage deferred, running fallback')
        ?.data?.reason,
    ).toBe('llmComplete/retry_recommended');
  });

  test('the fallback is retried once and its second candidate ships', async () => {
    const fallback = scriptedFallback((request, call) =>
      call === 1
        ? retryTriggering(request, 'first')
        : fallbackCandidate(request, { userMessage: 'second' }),
    );
    const { result } = await run(
      makeRequest('hide the tasks'),
      talk({ select: { scope: 'ambiguous' } }),
      { fallback },
    );
    expect(shipped(result).userMessage).toBe('second');
    expect(fallback.inputs).toHaveLength(2);
    expect(fallback.inputs[1]?.retry?.attempt).toBe(1);
  });

  test('the fallback is not called a third time; the last candidate ships healed', async () => {
    const fallback = scriptedFallback((request, call) =>
      retryTriggering(request, `attempt ${call}`),
    );
    const { result } = await run(
      makeRequest('hide the tasks'),
      talk({ select: { scope: 'ambiguous' } }),
      { fallback },
    );
    const response = shipped(result);
    expect(fallback.inputs).toHaveLength(2);
    expect(response.userMessage).toBe('attempt 2');
    expect(response.layout.tree).toEqual([]);
  });

  test('a chart_resize turn runs the pipeline and re-fits the layout', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Rearranged for the new size.' });
    const { result, calls, fallback } = await run(
      makeResizeRequest(12, 20),
      talk({ layout: 'column' }),
    );
    const layoutCall = calls.find((call) => 'layout' in call.questions);
    expect(
      Object.keys(layoutCall?.questions.layout?.criteria ?? {}),
    ).not.toContain('preserve');
    expect(shipped(result).layout.tree).toEqual([
      'H:1,1,1',
      'ID:calendar-main',
      'ID:weather-main',
      'ID:tasks-main',
    ]);
    expect(fallback.inputs).toHaveLength(0);
  });
});
