import { describe, expect, test } from 'bun:test';

import { CallId, RunId, type AgentRunMetrics } from '@maelstrom-co/protocol';

import { BUDGET_CLOSING_MESSAGE } from './agent-run.js';
import { createTranscript, toolCallRef } from './transcript.js';

const firstRun = RunId('run-1');
const secondRun = RunId('run-2');
const metrics: AgentRunMetrics = {
  turns: 1,
  toolCalls: 0,
  elapsedMs: 10,
  inputTokens: 5,
  outputTokens: 3,
};

describe('createTranscript', () => {
  test('renders two runs in order with run-qualified tool refs and summaries only', () => {
    const transcript = createTranscript();
    const firstCall = toolCallRef(firstRun, CallId('c1'));
    const secondCall = toolCallRef(secondRun, CallId('c1'));

    transcript.recordUserInput(firstRun, 'Where is my order?');
    transcript.recordToolCall(firstCall, 'latest_order', { limit: 1 });
    transcript.recordToolResult(firstCall, true, 'Found order order-42');
    transcript.recordMessage(firstRun, 'run-1:t2', 'Your order ');
    transcript.recordMessage(firstRun, 'run-1:t2', 'ships today.');
    transcript.recordEnding(firstRun, {
      type: 'finished',
      reason: 'completed',
      reply: 'Your order ships today.',
      metrics,
      unreportedUsageCalls: 0,
    });
    transcript.recordUserInput(secondRun, 'And the one before?');
    transcript.recordToolCall(secondCall, 'latest_order', { skip: 1 });
    transcript.recordToolResult(secondCall, false, 'latest_order failed');

    const messages = transcript.renderPriorMessages();

    expect(firstCall).toBe(toolCallRef(firstRun, CallId('c1')));
    expect(String(firstCall)).toBe('run-1:c1');
    expect(messages).toEqual([
      { role: 'user', content: 'Where is my order?' },
      {
        role: 'assistant',
        content: [
          '[tool call run-1:c1] latest_order {"limit":1}',
          '[tool result run-1:c1] ok: Found order order-42',
          'Your order ships today.',
        ].join('\n'),
      },
      { role: 'user', content: 'And the one before?' },
      {
        role: 'assistant',
        content: [
          '[tool call run-2:c1] latest_order {"skip":1}',
          '[tool result run-2:c1] failed: latest_order failed',
        ].join('\n'),
      },
    ]);
  });

  test('keeps reply text of separate turns apart', () => {
    const transcript = createTranscript();
    transcript.recordUserInput(firstRun, 'Hi');
    transcript.recordMessage(firstRun, 'run-1:t1', 'Checking.');
    transcript.recordMessage(firstRun, 'run-1:t2', 'Done.');

    expect(transcript.renderPriorMessages()).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Checking.\nDone.' },
    ]);
  });

  test('a budget ending shows the closing message and the limit', () => {
    const transcript = createTranscript();
    transcript.recordUserInput(firstRun, 'Check everything');
    transcript.recordClosingMessage(firstRun, BUDGET_CLOSING_MESSAGE);
    transcript.recordEnding(firstRun, {
      type: 'finished',
      reason: 'budget',
      reply: BUDGET_CLOSING_MESSAGE,
      limit: 'turns',
      metrics,
      unreportedUsageCalls: 0,
    });

    expect(transcript.renderPriorMessages()).toEqual([
      { role: 'user', content: 'Check everything' },
      {
        role: 'assistant',
        content: [
          `[closing message run-1] ${BUDGET_CLOSING_MESSAGE}`,
          '[run run-1 ended: budget, limit turns]',
        ].join('\n'),
      },
    ]);
  });

  test('a token budget ending notes unknown usage', () => {
    const transcript = createTranscript();
    transcript.recordEnding(firstRun, {
      type: 'finished',
      reason: 'budget',
      reply: BUDGET_CLOSING_MESSAGE,
      limit: 'tokens',
      usageUnknown: true,
      metrics,
      unreportedUsageCalls: 1,
    });

    expect(transcript.renderPriorMessages()).toEqual([
      {
        role: 'assistant',
        content: '[run run-1 ended: budget, limit tokens, usage unknown]',
      },
    ]);
  });

  test('an error ending marks the partial reply as ended with the error', () => {
    const transcript = createTranscript();
    transcript.recordUserInput(firstRun, 'Summarize my orders');
    transcript.recordMessage(firstRun, 'run-1:t1', 'You have three');
    transcript.recordEnding(firstRun, {
      type: 'finished',
      reason: 'error',
      reply: '',
      code: 'provider_error',
      error: 'The model provider failed.',
      metrics,
      unreportedUsageCalls: 0,
    });

    expect(transcript.renderPriorMessages()).toEqual([
      { role: 'user', content: 'Summarize my orders' },
      {
        role: 'assistant',
        content: [
          'You have three',
          '[run run-1 ended: error provider_error, The model provider failed., reply above is partial]',
        ].join('\n'),
      },
    ]);
  });

  test('a cancelled ending is recorded without its cause', () => {
    const transcript = createTranscript();
    const cause = new Error('internal abort detail');
    transcript.recordUserInput(firstRun, 'List orders');
    transcript.recordEnding(firstRun, {
      type: 'finished',
      reason: 'cancelled',
      reply: '',
      cause,
      metrics,
      unreportedUsageCalls: 0,
    });

    const messages = transcript.renderPriorMessages();

    expect(messages).toEqual([
      { role: 'user', content: 'List orders' },
      { role: 'assistant', content: '[run run-1 ended: cancelled]' },
    ]);
    expect(JSON.stringify(messages)).not.toContain(cause.message);
  });

  test('a completed ending adds no line', () => {
    const transcript = createTranscript();
    transcript.recordUserInput(firstRun, 'Hello');
    transcript.recordMessage(firstRun, 'run-1:t1', 'Hi there.');
    const before = transcript.renderPriorMessages();

    transcript.recordEnding(firstRun, {
      type: 'finished',
      reason: 'completed',
      reply: 'Hi there.',
      metrics,
      unreportedUsageCalls: 0,
    });

    expect(transcript.renderPriorMessages()).toEqual(before);
  });

  test('renders arguments that cannot be serialized as a placeholder', () => {
    const transcript = createTranscript();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    transcript.recordToolCall(
      toolCallRef(firstRun, CallId('c1')),
      'latest_order',
      cyclic,
    );

    expect(transcript.renderPriorMessages()).toEqual([
      {
        role: 'assistant',
        content:
          '[tool call run-1:c1] latest_order "[unserializable arguments]"',
      },
    ]);
  });
});
