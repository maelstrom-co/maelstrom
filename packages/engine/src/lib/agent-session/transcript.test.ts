import { describe, expect, test } from 'bun:test';

import { CallId, RunId, type AgentRunMetrics } from '@maelstrom-co/protocol';

import { BUDGET_CLOSING_MESSAGE } from './agent-run.js';
import {
  createTranscript,
  TRANSCRIPT_MAX_CHARS,
  toolCallRef,
  type Transcript,
} from './transcript.js';

const firstRun = RunId('run-1');
const secondRun = RunId('run-2');
const thirdRun = RunId('run-3');
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

    transcript.recordUserInput(firstRun, 'Where is my order?');
    transcript.recordToolCall(firstRun, CallId('c1'), 'latest_order', {
      limit: 1,
    });
    transcript.recordToolResult(
      firstRun,
      CallId('c1'),
      true,
      'Found order order-42',
    );
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
    transcript.recordToolCall(secondRun, CallId('c1'), 'latest_order', {
      skip: 1,
    });
    transcript.recordToolResult(
      secondRun,
      CallId('c1'),
      false,
      'latest_order failed',
    );

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
    transcript.recordToolCall(firstRun, CallId('c1'), 'latest_order', cyclic);

    expect(transcript.renderPriorMessages()).toEqual([
      {
        role: 'assistant',
        content:
          '[tool call run-1:c1] latest_order "[unserializable arguments]"',
      },
    ]);
  });

  describe('retention bound', () => {
    test('defaults to the transcript character cap', () => {
      expect(TRANSCRIPT_MAX_CHARS).toBe(64_000);
    });

    test('evicts the oldest whole runs once the total exceeds maxChars', () => {
      const transcript = createTranscript({ maxChars: 220 });
      recordRunWithTool(transcript, firstRun, 'a'.repeat(30));
      recordRunWithTool(transcript, secondRun, 'b'.repeat(30));

      expect(serialized(transcript)).toContain('run-1');

      recordRunWithTool(transcript, thirdRun, 'c'.repeat(30));

      const rendered = serialized(transcript);
      expect(rendered).not.toContain('run-1');
      expect(rendered).not.toContain('a'.repeat(30));
      expect(rendered).toContain('b'.repeat(30));
      expect(rendered).toContain('c'.repeat(30));
      expect(transcript.renderPriorMessages()).toEqual([
        { role: 'user', content: 'b'.repeat(30) },
        {
          role: 'assistant',
          content: [
            '[tool call run-2:c1] latest_order {}',
            '[tool result run-2:c1] ok: done',
          ].join('\n'),
        },
        { role: 'user', content: 'c'.repeat(30) },
        {
          role: 'assistant',
          content: [
            '[tool call run-3:c1] latest_order {}',
            '[tool result run-3:c1] ok: done',
          ].join('\n'),
        },
      ]);
    });

    test('keeps the newest run alone when it exceeds maxChars by itself', () => {
      const transcript = createTranscript({ maxChars: 50 });
      recordRunWithTool(transcript, firstRun, 'short');
      transcript.recordUserInput(secondRun, 'x'.repeat(200));
      transcript.recordMessage(secondRun, 'run-2:t1', 'y'.repeat(100));

      expect(transcript.renderPriorMessages()).toEqual([
        { role: 'user', content: 'x'.repeat(200) },
        { role: 'assistant', content: 'y'.repeat(100) },
      ]);
    });

    test('evicts an oversized run as soon as a newer run starts', () => {
      const transcript = createTranscript({ maxChars: 50 });
      transcript.recordUserInput(firstRun, 'x'.repeat(200));
      transcript.recordUserInput(secondRun, 'next');

      expect(transcript.renderPriorMessages()).toEqual([
        { role: 'user', content: 'next' },
      ]);
    });

    test('counts reply text appended to an earlier turn toward the bound', () => {
      const transcript = createTranscript({ maxChars: 60 });
      transcript.recordUserInput(firstRun, 'first');
      transcript.recordUserInput(secondRun, 'second');
      transcript.recordMessage(secondRun, 'run-2:t1', 'z'.repeat(30));
      transcript.recordMessage(secondRun, 'run-2:t1', 'z'.repeat(30));

      expect(serialized(transcript)).not.toContain('first');
      expect(transcript.renderPriorMessages()).toEqual([
        { role: 'user', content: 'second' },
        { role: 'assistant', content: 'z'.repeat(60) },
      ]);
    });

    test('keeps every tool call of a kept run with its result', () => {
      const transcript = createTranscript({ maxChars: 250 });
      recordRunWithTool(transcript, firstRun, 'a'.repeat(100));
      transcript.recordUserInput(secondRun, 'two calls');
      transcript.recordToolCall(secondRun, CallId('c1'), 'latest_order', {});
      transcript.recordToolCall(secondRun, CallId('c2'), 'latest_order', {});
      transcript.recordToolResult(secondRun, CallId('c1'), true, 'one');
      transcript.recordToolResult(secondRun, CallId('c2'), false, 'two');
      recordRunWithTool(transcript, thirdRun, 'c'.repeat(20));

      const lines = transcript
        .renderPriorMessages()
        .flatMap((message) => message.content.split('\n'));
      const callRefs = lines
        .filter((line) => line.startsWith('[tool call '))
        .map((line) => line.slice('[tool call '.length).split(']')[0]);
      const resultRefs = lines
        .filter((line) => line.startsWith('[tool result '))
        .map((line) => line.slice('[tool result '.length).split(']')[0]);

      expect(callRefs).toEqual(['run-2:c1', 'run-2:c2', 'run-3:c1']);
      expect(resultRefs).toEqual(['run-2:c1', 'run-2:c2', 'run-3:c1']);
    });
  });
});

function recordRunWithTool(
  transcript: Transcript,
  runId: RunId,
  text: string,
): void {
  transcript.recordUserInput(runId, text);
  transcript.recordToolCall(runId, CallId('c1'), 'latest_order', {});
  transcript.recordToolResult(runId, CallId('c1'), true, 'done');
  transcript.recordEnding(runId, {
    type: 'finished',
    reason: 'completed',
    reply: '',
    metrics,
    unreportedUsageCalls: 0,
  });
}

function serialized(transcript: Transcript): string {
  return JSON.stringify(transcript.renderPriorMessages());
}
