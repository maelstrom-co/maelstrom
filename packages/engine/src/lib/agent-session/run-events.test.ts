import { describe, expect, test } from 'bun:test';

import {
  AGENT_WIRE_VERSION,
  AgentEventSchema,
  type AgentFinishReason,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';

import {
  type AgentRunCounters,
  buildAcceptanceEvents,
  buildRunEnding,
  type RunBudgetExhaustion,
  type RunFailure,
} from './run-events.js';

const run = { runId: RunId('run-1'), started: 10.2 };
const metrics = {
  turns: 0,
  toolCalls: { requested: 0, admitted: 0 },
  elapsedMs: 20,
  inputTokens: 0,
  outputTokens: 0,
};

const metricsMetadata = {
  turns: 0,
  toolCallsRequested: 0,
  toolCallsAdmitted: 0,
  elapsedMs: 20,
  inputTokens: 0,
  outputTokens: 0,
};

test('an accepted input announces a placeholder before the UI-only run it starts', () => {
  const events = buildAcceptanceEvents(MessageId('input-1'), run.runId);
  expect(events).toEqual([
    {
      type: 'placeholder',
      version: AGENT_WIRE_VERSION,
      inputId: MessageId('input-1'),
      text: 'One moment.',
    },
    {
      type: 'accepted',
      version: AGENT_WIRE_VERSION,
      inputId: MessageId('input-1'),
      runId: run.runId,
      disposition: 'ui_only',
      ack: 'On it.',
    },
  ]);
  expect(
    events.every((event) => AgentEventSchema.safeParse(event).success),
  ).toBe(true);
});

test('a completed run streams its reply before finishing with rounded elapsed time', () => {
  const ending = buildRunEnding(run, 30.4, 'Done.');
  expect(ending.events).toEqual([
    {
      type: 'message',
      version: AGENT_WIRE_VERSION,
      runId: run.runId,
      turnId: 'run-1:reply',
      delta: 'Done.',
    },
    {
      type: 'finished',
      version: AGENT_WIRE_VERSION,
      runId: run.runId,
      ok: true,
      reason: 'completed',
      reply: 'Done.',
      metrics,
    },
  ]);
  expect(ending.metadata).toEqual({
    reason: 'completed',
    outcome: 'succeeded',
    ...metricsMetadata,
    durationMs: 20,
  });
  expect(
    ending.events.every((event) => AgentEventSchema.safeParse(event).success),
  ).toBe(true);
});

test('a failed run finishes without its reply and reports the failure code', () => {
  const ending = buildRunEnding(run, 30.4, 'Unused.', {
    code: 'ui_apply_failed',
    error: 'The UI change could not be fully applied.',
  });
  expect(ending.events).toEqual([
    {
      type: 'finished',
      version: AGENT_WIRE_VERSION,
      runId: run.runId,
      code: 'ui_apply_failed',
      error: 'The UI change could not be fully applied.',
      ok: false,
      reason: 'error',
      metrics,
    },
  ]);
  expect(ending.events[0]).not.toHaveProperty('reply');
  expect(ending.metadata).toEqual({
    reason: 'error',
    outcome: 'failed',
    ...metricsMetadata,
    durationMs: 20,
    code: 'ui_apply_failed',
  });
});

test('a cancelled run keeps its reason and never reports negative elapsed time', () => {
  const ending = buildRunEnding(run, 0, undefined, {
    reason: 'cancelled',
    code: 'ui_ack_timeout',
    error: 'The preceding UI change was not acknowledged.',
  });
  expect(ending.events).toMatchObject([
    {
      type: 'finished',
      ok: false,
      reason: 'cancelled',
      metrics: { elapsedMs: 0 },
    },
  ]);
  expect(ending.events[0]).not.toHaveProperty('reply');
  expect(ending.metadata).toMatchObject({
    reason: 'cancelled',
    outcome: 'failed',
    code: 'ui_ack_timeout',
  });
  expect(
    ending.events.every((event) => AgentEventSchema.safeParse(event).success),
  ).toBe(true);
});

test('a completed run without a reply sends no message and finishes without a reply', () => {
  const ending = buildRunEnding(run, 30.4, undefined);
  expect(ending.events).toEqual([
    {
      type: 'finished',
      version: AGENT_WIRE_VERSION,
      runId: run.runId,
      ok: true,
      reason: 'completed',
      metrics,
    },
  ]);
  expect(ending.events[0]).not.toHaveProperty('reply');
  expect(
    ending.events.every((event) => AgentEventSchema.safeParse(event).success),
  ).toBe(true);
});

test('a completed run with an empty reply sends no message and finishes without a reply', () => {
  const ending = buildRunEnding(run, 30.4, '');
  expect(ending.events.map((event) => event.type)).toEqual(['finished']);
  expect(ending.events[0]).not.toHaveProperty('reply');
});

test('a completed run with a whitespace-only reply sends no message and finishes without a reply', () => {
  const ending = buildRunEnding(run, 30.4, '\n  ');
  expect(ending.events.map((event) => event.type)).toEqual(['finished']);
  expect(ending.events[0]).not.toHaveProperty('reply');
});

test('an agent acceptance carries the agent disposition', () => {
  expect(
    buildAcceptanceEvents(MessageId('input-1'), run.runId, 'agent')[1],
  ).toMatchObject({ type: 'accepted', disposition: 'agent' });
});

const counters = {
  turns: 2,
  toolCalls: { requested: 3, admitted: 1 },
  elapsedMs: 15,
  inputTokens: 14,
  outputTokens: 3,
  unreportedUsageCalls: 1,
};

test('a completed agent run finishes with its counters, including its own elapsed time, and no extra reply message, since the reply was streamed', () => {
  const ending = buildRunEnding(run, 30.4, 'Done.', undefined, counters);
  expect(ending.events).toEqual([
    {
      type: 'finished',
      version: AGENT_WIRE_VERSION,
      runId: run.runId,
      ok: true,
      reason: 'completed',
      reply: 'Done.',
      metrics: {
        turns: 2,
        toolCalls: { requested: 3, admitted: 1 },
        elapsedMs: 15,
        inputTokens: 14,
        outputTokens: 3,
      },
    },
  ]);
  expect(ending.metadata).toEqual({
    reason: 'completed',
    outcome: 'succeeded',
    turns: 2,
    toolCallsRequested: 3,
    toolCallsAdmitted: 1,
    elapsedMs: 15,
    inputTokens: 14,
    outputTokens: 3,
    durationMs: 15,
    unreportedUsageCalls: 1,
  });
});

test('a completed agent run whose last turn had no text finishes without a reply', () => {
  const ending = buildRunEnding(run, 30.4, undefined, undefined, counters);
  expect(ending.events).toMatchObject([
    { type: 'finished', ok: true, reason: 'completed' },
  ]);
  expect(ending.events[0]).not.toHaveProperty('reply');
});

test('a budget ending sends the closing message under the close turn and makes it the reply', () => {
  const ending = buildRunEnding(
    run,
    30.4,
    'ignored',
    { reason: 'budget', limit: 'turns', closingMessage: 'Out of room.' },
    counters,
  );
  expect(ending.events).toEqual([
    {
      type: 'message',
      version: AGENT_WIRE_VERSION,
      runId: run.runId,
      turnId: 'run-1:close',
      delta: 'Out of room.',
    },
    {
      type: 'finished',
      version: AGENT_WIRE_VERSION,
      runId: run.runId,
      ok: false,
      reason: 'budget',
      reply: 'Out of room.',
      metrics: {
        turns: 2,
        toolCalls: { requested: 3, admitted: 1 },
        elapsedMs: 15,
        inputTokens: 14,
        outputTokens: 3,
      },
    },
  ]);
  expect(ending.metadata).toMatchObject({
    reason: 'budget',
    outcome: 'failed',
    limit: 'turns',
    unreportedUsageCalls: 1,
  });
  expect(ending.metadata).not.toHaveProperty('code');
  expect(
    ending.events.every((event) => AgentEventSchema.safeParse(event).success),
  ).toBe(true);
});

const endings: readonly (readonly [
  AgentFinishReason,
  RunFailure | RunBudgetExhaustion | undefined,
])[] = [
  ['completed', undefined],
  [
    'budget',
    { reason: 'budget', limit: 'turns', closingMessage: 'Out of room.' },
  ],
  ['error', { code: 'internal_error', error: 'The run failed.' }],
  [
    'cancelled',
    { reason: 'cancelled', code: 'cancelled', error: 'The run was cancelled.' },
  ],
];

describe.each([
  ['an agent run', counters],
  ['a UI-only run', undefined],
] as const)('%s', (_route, runCounters: AgentRunCounters | undefined) => {
  test.each(endings)(
    'an ending with reason %s reports durationMs equal to elapsedMs and the counters of finished.metrics, with tool calls split into requested and admitted',
    (reason, outcome) => {
      const ending = buildRunEnding(run, 30.4, 'Done.', outcome, runCounters);
      const finished = ending.events.at(-1);
      if (finished?.type !== 'finished') throw new Error('no finished event');
      expect(finished.reason).toBe(reason);
      expect(ending.metadata.durationMs).toBe(finished.metrics.elapsedMs);
      const { toolCalls, ...scalarCounters } = finished.metrics;
      expect(ending.metadata).toMatchObject({
        ...scalarCounters,
        toolCallsRequested: toolCalls.requested,
        toolCallsAdmitted: toolCalls.admitted,
      });
      expect(ending.metadata).not.toHaveProperty('toolCalls');
      expect(
        Object.values(ending.metadata).every(
          (value) => typeof value !== 'object' || value === null,
        ),
      ).toBe(true);
    },
  );
});
