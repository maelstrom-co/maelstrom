import { afterEach, describe, expect, mock, test } from 'bun:test';

import {
  GridModelOutputSchema,
  isErr,
  isOk,
  TilingModelOutputSchema,
} from '@maelstrom-co/protocol';
import { convertSchemaToJsonSchema } from '@tanstack/ai';
import { z } from 'zod';

import { dummyAdapter } from './__test-helpers__/fixtures.js';
import { callLLM, toPlanCandidate } from './call-llm.js';
import {
  skipReplyOutputSchemaFor,
  toPlannerOutput,
} from './skip-reply-output.js';

const mockChat = mock<(...args: unknown[]) => Promise<unknown>>();
const convertOutputSchema = convertSchemaToJsonSchema;

mock.module('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
  convertSchemaToJsonSchema: convertOutputSchema,
}));

afterEach(() => {
  mockChat.mockReset();
});

const rawGridOutput = {
  userMessage: 'Placed the calendar.',
  rationale: 'Top left has room.',
  executionPlan: [],
  layout: {
    positions: [
      {
        instanceId: 'calendar-main',
        position: { row: 0, column: 0 },
        size: { width: 6, height: 4 },
      },
    ],
  },
};

const rawTilingOutput = {
  userMessage: 'Split the screen.',
  rationale: 'Two panes side by side.',
  executionPlan: [],
  layout: {
    tree: ['H', 'ID:calendar-main', 'ID:notes-main'],
    instances: [
      { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
      { instanceId: 'notes-main', vesselId: 'notes', variant: 'list' },
    ],
  },
};

describe('callLLM', () => {
  test('sends the JSON schema of the given output schema to chat()', async () => {
    const outputSchema = z.object({ answer: z.string() });
    mockChat.mockResolvedValueOnce({ answer: 'yes' });

    await callLLM(
      dummyAdapter,
      'system',
      'user',
      outputSchema,
      (parsed) => parsed,
      [],
      'thread-1',
    );

    expect(sentOutputSchema()).toEqual(convertOutputSchema(outputSchema));
  });

  test('returns the mapper result built from the parsed model output', async () => {
    const outputSchema = z.object({ answer: z.string() });
    const toResult = mock((parsed: { answer: string }) => ({
      mapped: parsed.answer.toUpperCase(),
    }));
    mockChat.mockResolvedValueOnce({ answer: 'yes', extra: 'dropped' });

    const result = await callLLM(
      dummyAdapter,
      'system',
      'user',
      outputSchema,
      toResult,
      [],
      'thread-1',
    );

    expect(toResult).toHaveBeenCalledTimes(1);
    expect(toResult).toHaveBeenCalledWith({ answer: 'yes' });
    expect(result).toEqual({ ok: true, value: { mapped: 'YES' } });
  });

  test('does not call the mapper when the parse fails, and returns ProviderError', async () => {
    const toResult = mock((parsed: { answer: string }) => parsed);
    mockChat.mockResolvedValueOnce({ answer: 42 });

    const result = await callLLM(
      dummyAdapter,
      'system',
      'user',
      z.object({ answer: z.string() }),
      toResult,
      [],
      'thread-1',
    );

    expect(toResult).not.toHaveBeenCalled();
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('ProviderError');
  });

  test('does not call the mapper when the request is cancelled during chat()', async () => {
    const controller = new AbortController();
    const toResult = mock((parsed: { answer: string }) => parsed);
    mockChat.mockImplementationOnce(async () => {
      controller.abort('user left');
      return { answer: 'yes' };
    });

    const result = await callLLM(
      dummyAdapter,
      'system',
      'user',
      z.object({ answer: z.string() }),
      toResult,
      [],
      'thread-1',
      controller.signal,
    );

    expect(toResult).not.toHaveBeenCalled();
    expect(isErr(result)).toBe(true);
    if (!isErr(result)) return;
    expect(result.error._tag).toBe('CancellationError');
  });

  test.each([
    ['grid', GridModelOutputSchema, rawGridOutput],
    ['tiling', TilingModelOutputSchema, rawTilingOutput],
  ] as const)(
    'the plan candidate mapper receives untagged %s model output and stamps type plan',
    async (_mode, outputSchema, rawOutput) => {
      const toResult = mock(toPlanCandidate);
      mockChat.mockResolvedValueOnce(rawOutput);

      const result = await callLLM(
        dummyAdapter,
        'system',
        'user',
        outputSchema,
        toResult,
        [],
        'thread-1',
      );

      expect(toResult.mock.calls[0]?.[0]).not.toHaveProperty('type');
      expect(result).toEqual({
        ok: true,
        value: { type: 'plan', ...outputSchema.parse(rawOutput) },
      });
    },
  );

  test('a skipReply schema and mapper turn a clarification into needs-clarification', async () => {
    const { userMessage: _omitted, ...replyless } = rawGridOutput;
    mockChat.mockResolvedValueOnce({
      ...replyless,
      clarification: { question: 'Which calendar?', options: ['Work'] },
    });

    const result = await callLLM(
      dummyAdapter,
      'system',
      'user',
      skipReplyOutputSchemaFor('grid'),
      toPlannerOutput,
      [],
      'thread-1',
    );

    expect(sentOutputSchema()).toEqual(
      convertOutputSchema(skipReplyOutputSchemaFor('grid')),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect<unknown>(result.value).toEqual({
      type: 'needs_clarification',
      question: 'Which calendar?',
      options: ['Work'],
      layout: replyless.layout,
      executionPlan: [],
    });
  });
});

function sentOutputSchema(): unknown {
  const args = mockChat.mock.calls[0]?.[0] as
    | { readonly outputSchema: unknown }
    | undefined;
  if (args === undefined) throw new Error('chat() was not called');
  return args.outputSchema;
}
