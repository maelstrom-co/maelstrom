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
import { fallbackCandidate } from '../__test-helpers__/poc-fixtures.js';
import {
  type Script,
  scriptedFetch,
  TEST_MODEL,
} from '../__test-helpers__/scripted-fetch.js';
import { stepwiseActions } from '../stages-experimental/actions-stepwise.js';
import { completeWithLayout } from '../stages-experimental/complete.js';
import { createJevDeps, type JevDeps } from '../stages-experimental/deps.js';
import { menuLayout } from '../stages-experimental/layout-menu.js';
import { selectUngated } from '../stages-experimental/select-ungated.js';
import type { LayoutStage } from '../stages-experimental/types.js';

afterEach(() => mockChat.mockReset());

async function run(request: ChartRequest, script: Script) {
  const { fetch } = scriptedFetch(script);
  const fallbackInputs: Retryable<PlanningInput>[] = [];
  const fallback: Stage<Retryable<PlanningInput>, PlannerCandidate> = async (
    input,
  ) => {
    fallbackInputs.push(input);
    return ok(fallbackCandidate(input.request));
  };
  const { logger, entries } = spyLogger();
  const engine = createEngine({
    planner: handOffPlanner(
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
      sessionId: SessionId('jev-ungated-stepwise'),
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
    fallbackInputs,
    deferral,
  };
}

/** The jev-ungated-stepwise stages, with the layout stage handing the tree to the LLM. */
function handOffPlanner(deps: JevDeps): Planner {
  const live = menuLayout(deps.ask);
  const handOff: LayoutStage = async (plan, ctx) => {
    const result = await live(plan, ctx);
    if (isErr(result)) return result;
    const { tree: _tree, layoutId: _layoutId, ...rest } = result.value;
    return ok({ ...rest, source: 'llm' });
  };
  return withFallback(
    pipeline(
      selectUngated(deps.ask),
      stepwiseActions(deps.ask),
      handOff,
      completeWithLayout(deps.llm),
    ),
    withRetry(deps.fallback, { max: 1 }),
  );
}

describe('a layout hand-off through createEngine', () => {
  test('a hand-off without a tree asks the LLM for the layout and ships a fitting one', async () => {
    const tree = ['H', 'ID:weather-main', 'ID:calendar-main'];
    mockChat.mockResolvedValue({ userMessage: 'Stacked.', layout: { tree } });
    const { response, fallbackInputs } = await run(
      makeRequest('hide the tasks and stack the rest'),
      conversation({ select: { 'view/tasks-main': 'hide' } }),
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
    );
    expect(response.userMessage).toBe('from the fallback');
    expect(fallbackInputs).toHaveLength(1);
    expect(deferral).toBe('llmComplete/invalid_layout');
  });
});
