import { afterEach, describe, expect, test } from 'bun:test';

import {
  createEngine,
  type Planner,
  type PlannerCandidate,
  type PlanningInput,
  pipeline,
  type Retryable,
  type Stage,
  withFallback,
  withRetry,
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

import { conversation } from '../__test-helpers__/actions-fixtures.js';
import { makeRequest, plain, spyLogger } from '../__test-helpers__/fixtures.js';
import { dummyAdapter, mockChat } from '../__test-helpers__/mock-chat.js';
import {
  type Script,
  scriptedFetch,
  TEST_MODEL,
} from '../__test-helpers__/scripted-fetch.js';
import { stepwiseActions } from '../stages-next/actions-stepwise.js';
import { completeWithLayout } from '../stages-next/complete.js';
import { createJevDeps, type JevDeps } from '../stages-next/deps.js';
import { l0Layout } from '../stages-next/layout-l0.js';
import { selectV1 } from '../stages-next/select-v1.js';
import type { LayoutStage } from '../stages-next/types.js';
import { buildJevPocRebuiltPlanner } from './jev-poc-rebuilt.js';

afterEach(() => mockChat.mockReset());

function fallbackCandidate(request: ChartRequest): PlannerCandidate {
  return {
    userMessage: 'from the fallback',
    rationale: 'fallback',
    executionPlan: [],
    layout: {
      tree: ['V:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
      instances: request.instances.map(({ instanceId, vesselId, variant }) => ({
        instanceId,
        vesselId,
        variant,
      })),
    },
  } as unknown as PlannerCandidate;
}

async function run(
  request: ChartRequest,
  script: Script,
  build: (deps: JevDeps) => Planner = (deps) => buildJevPocRebuiltPlanner(deps),
) {
  const { fetch, calls } = scriptedFetch(script);
  const fallbackInputs: Retryable<PlanningInput>[] = [];
  const fallback: Stage<Retryable<PlanningInput>, PlannerCandidate> = async (
    input,
  ) => {
    fallbackInputs.push(input);
    return ok(fallbackCandidate(input.request));
  };
  const { logger, entries } = spyLogger();
  const engine = createEngine({
    planner: build(
      createJevDeps({
        typesafe: {
          apiKey: 'typesafe-test-key',
          model: TEST_MODEL,
          fetch,
          timeoutMs: 1000,
        },
        adapter: dummyAdapter,
        fallback,
      }),
    ),
    retry: false,
    logger,
  });
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId: SessionId('jev-poc-rebuilt'),
      id: MessageId('turn-1'),
      request,
    }),
  );
  if (!isOk(result) || result.value.type !== 'chart_response')
    throw new Error(`expected a chart response: ${JSON.stringify(result)}`);
  const deferral = entries.find(
    (e) => e.msg === 'Planner stage deferred, running fallback',
  )?.data?.reason;
  return {
    response: plain(result.value.response) as {
      userMessage: string;
      executionPlan: unknown[];
      layout: { tree: unknown[]; instances: { instanceId: string }[] };
    },
    calls,
    fallbackInputs,
    deferral,
  };
}

/** The live pipeline, with the layout stage handing the tree to the LLM. */
function handOffPlanner(deps: JevDeps): Planner {
  const live = l0Layout(deps.ask);
  const handOff: LayoutStage = async (plan, ctx) => {
    const result = await live(plan, ctx);
    if (isErr(result)) return result;
    const { tree: _tree, layoutId: _layoutId, ...rest } = result.value;
    return ok({ ...rest, source: 'llm' });
  };
  return withFallback(
    pipeline(
      selectV1(deps.ask),
      stepwiseActions(deps.ask),
      handOff,
      completeWithLayout(deps.llm),
    ),
    withRetry(deps.fallback, { max: 1 }),
  );
}

describe('buildJevPocRebuiltPlanner through createEngine', () => {
  test('a hide request ships the selection with the mocked message', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Tasks are hidden.' });
    const { response, fallbackInputs, calls } = await run(
      makeRequest('hide the tasks'),
      conversation({ select: { 'view/tasks-main': 'hide' }, layout: 'row' }),
    );
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
    expect(fallbackInputs).toHaveLength(0);
    expect(calls).toHaveLength(3);
  });

  test('"show the weather in Tokyo" ships setLocation bound by Jev', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Showing Tokyo.' });
    const { response, fallbackInputs } = await run(
      makeRequest('show the weather in Tokyo'),
      conversation({
        actions: [
          {
            pick: 'weather-main/setLocation',
            params: { location: { value: 'Tokyo' } },
          },
        ],
        layout: 'preserve',
      }),
    );
    expect(response.executionPlan).toEqual([
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        params: { location: 'Tokyo' },
      },
    ]);
    expect(fallbackInputs).toHaveLength(0);
  });

  test('a hand-off without a tree asks the LLM for the layout and ships a fitting one', async () => {
    const tree = ['H', 'ID:weather-main', 'ID:calendar-main'];
    mockChat.mockResolvedValue({ userMessage: 'Stacked.', layout: { tree } });
    const { response, fallbackInputs } = await run(
      makeRequest('hide the tasks and stack the rest'),
      conversation({ select: { 'view/tasks-main': 'hide' } }),
      handOffPlanner,
    );
    const schema = mockChat.mock.calls[0]?.[0].outputSchema;
    expect(Object.keys(schema?.shape ?? {})).toContain('layout');
    expect(response.layout.tree).toEqual(tree);
    expect(fallbackInputs).toHaveLength(0);
  });

  test('a hand-off whose tree does not fit defers to the fallback', async () => {
    mockChat.mockResolvedValue({
      userMessage: 'Stacked.',
      layout: { tree: ['ID:weather-main'] },
    });
    const { response, fallbackInputs, deferral } = await run(
      makeRequest('hide the tasks and stack the rest'),
      conversation({ select: { 'view/tasks-main': 'hide' } }),
      handOffPlanner,
    );
    expect(response.userMessage).toBe('from the fallback');
    expect(fallbackInputs).toHaveLength(1);
    expect(deferral).toBe('llmComplete/invalid_layout');
  });
});
