import { expect, test } from 'bun:test';
import {
  AGENT_WIRE_VERSION,
  AgentEventSchema,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';
import { buildAcceptanceEvents, buildRunEnding } from './run-events.js';

const run = { runId: RunId('run-1'), started: 10.2 };
const metrics = {
  turns: 0,
  toolCalls: 0,
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
    ...metrics,
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
      reply: '',
      metrics,
    },
  ]);
  expect(ending.metadata).toEqual({
    reason: 'error',
    outcome: 'failed',
    ...metrics,
    code: 'ui_apply_failed',
  });
});

test('a cancelled run keeps its reason and never reports negative elapsed time', () => {
  const ending = buildRunEnding(run, 0, '', {
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
  expect(ending.metadata).toMatchObject({
    reason: 'cancelled',
    outcome: 'failed',
    code: 'ui_ack_timeout',
  });
  expect(
    ending.events.every((event) => AgentEventSchema.safeParse(event).success),
  ).toBe(true);
});
