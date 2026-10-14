import {
  createEngine,
  type Planner,
  type PlannerCandidate,
  type PlanningInput,
  type Retryable,
  type Stage,
} from '@maelstrom-co/engine';
import {
  type ChartRequest,
  ChartRequestMessage,
  isOk,
  MessageId,
  ok,
  SessionId,
} from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { z } from 'zod';

import { createStageDeps } from '../planners/jev-stage-planner.js';
import type { JevDeps } from '../stages/stage-deps.js';
import type { TypeSafeClientOptions } from '../typesafe-client.js';
import { type Conversation, conversation } from './actions-fixtures.js';
import {
  makeRequest,
  makeResizeRequest,
  plain,
  silentLogger,
} from './fixtures.js';
import { dummyAdapter, mockChat } from './mock-chat.js';
import { scriptedDecisionsAsk } from './scripted-decisions-fetch.js';
import { type Payload, scriptedFetch, TEST_MODEL } from './scripted-fetch.js';

/** One request the frozen POC and the stage-library planners are pinned on. */
export interface PocCase {
  readonly name: string;
  readonly request: ChartRequest;
  readonly script: Conversation;
  /** What the mocked completion call returns. */
  readonly completion: unknown;
}

/** The options a planner builder under comparison receives. */
export interface PlannerFixtureOptions {
  readonly typesafe: TypeSafeClientOptions;
  readonly adapter: AnyTextAdapter;
  readonly fallback: Stage<Retryable<PlanningInput>, PlannerCandidate>;
}

/** Everything a planner sent and shipped for one {@link PocCase}, as plain JSON. */
export interface PocRun {
  /** Every TypeSafe request body, in order. */
  readonly evaluations: readonly Payload[];
  /** Every completion call: prompts and the output schema as JSON Schema. */
  readonly completions: readonly unknown[];
  readonly fallbackCalls: number;
  readonly response: unknown;
}

export const POC_CASES: readonly PocCase[] = [
  {
    name: 'hide',
    request: makeRequest('hide the tasks'),
    script: { select: { 'view/tasks-main': 'hide' }, layout: 'row' },
    completion: { userMessage: 'Tasks are hidden.' },
  },
  {
    name: 'tokyo',
    request: makeRequest('show the weather in Tokyo'),
    script: {
      actions: [
        {
          pick: 'weather-main/setLocation',
          params: { location: { value: 'Tokyo' } },
        },
      ],
      layout: 'preserve',
      confidence: 0.8,
    },
    completion: { userMessage: 'Showing Tokyo.' },
  },
  {
    name: 'stated-elsewhere',
    request: makeRequest('weather for the capital of Japan'),
    script: {
      actions: [
        {
          pick: 'weather-main/setLocation',
          params: { location: 'stated_elsewhere' },
        },
      ],
      layout: 'preserve',
    },
    completion: { userMessage: 'Weather for Tokyo.', params: { p0: 'Tokyo' } },
  },
  {
    name: 'not-stated',
    request: makeRequest('add a task and show the weekly forecast'),
    script: {
      actions: [
        {
          pick: 'tasks-main/addTask',
          params: { title: 'not_stated', urgent: 'omit' },
        },
        { pick: 'weather-main/showWeekly' },
      ],
      layout: 'preserve',
    },
    completion: {
      userMessage: 'Weekly forecast is up. What should the task say?',
    },
  },
  {
    name: 'transition',
    request: makeRequest('open the journal entry "Monday"'),
    script: {
      select: { 'view/journal-main': 'keep' },
      actions: [
        {
          pick: 'journal-main/openEntry',
          params: { title: { value: 'Monday' } },
        },
      ],
      layout: 'focus/V/journal-main',
    },
    completion: { userMessage: 'Opened Monday.' },
  },
  {
    name: 'create',
    request: makeRequest('add a second weather widget'),
    script: { select: { 'new/weather': 'one/current' } },
    completion: { userMessage: 'Added a weather widget.' },
  },
  {
    name: 'resize',
    request: makeResizeRequest(12, 20),
    script: { layout: 'column' },
    completion: { userMessage: 'Rearranged for the new size.' },
  },
  {
    name: 'deferred',
    request: makeRequest('hide the tasks'),
    script: { select: { scope: 'ambiguous' } },
    completion: { userMessage: 'unused' },
  },
];

/** A valid candidate for `request`, marked so tests can tell it shipped. */
export function fallbackCandidate(
  request: ChartRequest,
  {
    tree = ['V:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
    userMessage = 'from the fallback',
  }: { readonly tree?: readonly string[]; readonly userMessage?: string } = {},
): PlannerCandidate {
  return {
    userMessage,
    rationale: 'fallback',
    executionPlan: [],
    layout: {
      tree,
      instances: request.instances.map(({ instanceId, vesselId, variant }) => ({
        instanceId,
        vesselId,
        variant,
      })),
    },
  } as unknown as PlannerCandidate;
}

/**
 * Plans `fixture` through `createEngine` with `retry: false`, answering Jev
 * from its script and the completion call from its mocked reply.
 */
export async function runPocCase(
  fixture: PocCase,
  build: (options: PlannerFixtureOptions) => Planner,
): Promise<PocRun> {
  const { fetch, calls } = scriptedFetch(conversation(fixture.script));
  return planPocCase(fixture, calls, (fallback) =>
    build({
      typesafe: {
        apiKey: 'typesafe-test-key',
        model: TEST_MODEL,
        fetch,
        timeoutMs: 1000,
      },
      adapter: dummyAdapter,
      fallback,
    }),
  );
}

/**
 * Plans `fixture` as {@link runPocCase} does, with the planner built over
 * the scripted Decisions transport. The recorded evaluations are the
 * decoded, TypeSafe-shaped payloads.
 */
export async function runPocCaseOnDecisions(
  fixture: PocCase,
  build: (deps: JevDeps) => Planner,
): Promise<PocRun> {
  const { ask, calls } = scriptedDecisionsAsk(conversation(fixture.script));
  return planPocCase(fixture, calls, (fallback) =>
    build(
      createStageDeps(
        ask,
        { adapter: dummyAdapter, fallback },
        'StageDepsOptions',
      ),
    ),
  );
}

async function planPocCase(
  fixture: PocCase,
  calls: readonly Payload[],
  build: (
    fallback: Stage<Retryable<PlanningInput>, PlannerCandidate>,
  ) => Planner,
): Promise<PocRun> {
  mockChat.mockReset();
  mockChat.mockResolvedValue(fixture.completion);
  let fallbackCalls = 0;
  const fallback: Stage<Retryable<PlanningInput>, PlannerCandidate> = async (
    input,
  ) => {
    fallbackCalls += 1;
    return ok(fallbackCandidate(input.request));
  };
  const engine = createEngine({
    planner: build(fallback),
    retry: false,
    logger: silentLogger,
  });
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId: SessionId('poc-fixtures'),
      id: MessageId(`poc-${fixture.name}`),
      request: fixture.request,
    }),
  );
  if (!isOk(result) || result.value.type !== 'chart_response')
    throw new Error(`${fixture.name}: no chart response`);
  const completions = mockChat.mock.calls.map(([options]) =>
    plain({
      systemPrompts: options.systemPrompts,
      messages: options.messages,
      schema: z.toJSONSchema(options.outputSchema),
    }),
  );
  mockChat.mockReset();
  return {
    evaluations: plain(calls) as Payload[],
    completions,
    fallbackCalls,
    response: plain(result.value.response),
  };
}
