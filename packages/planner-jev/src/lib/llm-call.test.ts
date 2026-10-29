import { afterEach, describe, expect, test } from 'bun:test';
import type { InstrumentAttributes } from '@maelstrom-co/engine';
import { MessageId, SessionId } from '@maelstrom-co/protocol';
import type {
  AnyTextAdapter,
  RunErrorEvent,
  RunFinishedEvent,
  StreamChunk,
  TokenUsage,
} from '@tanstack/ai';
import { z } from 'zod';
import {
  makeContext,
  makeInput,
  makeRequest,
} from './__test-helpers__/fixtures.js';
import {
  dummyAdapter as baseAdapter,
  chatCall,
  installMockChat,
  mockChat,
} from './__test-helpers__/mock-chat.js';
import { callLlm } from './llm-call.js';

installMockChat();
afterEach(() => mockChat.mockReset());

function context(signal?: AbortSignal, messageId = 'req-1') {
  const events: { name: string; attributes: InstrumentAttributes }[] = [];
  const ctx = makeContext(
    {
      ...makeInput(makeRequest('hide the tasks')),
      messageId: MessageId(messageId),
    },
    {
      signal,
      instrument: {
        stage: (_name, stage) => stage,
        event: (name, attributes) => events.push({ name, attributes }),
      },
    },
  );
  return { ctx, events };
}

const schema = z.object({ userMessage: z.string() });
const dummyAdapter: AnyTextAdapter = {
  ...baseAdapter,
  async *chatStream(options) {
    yield* options.modelOptions?.fixtureChunks as StreamChunk[];
  },
};
const complete = (ctx: ReturnType<typeof context>['ctx']) =>
  callLlm({ adapter: dummyAdapter }, 'private prompt', schema, [], ctx);

async function reportUsage(
  adapter: AnyTextAdapter,
  usage: TokenUsage,
  duplicate?: StreamChunk,
) {
  const terminal: StreamChunk = {
    type: 'RUN_FINISHED' as RunFinishedEvent['type'],
    runId: 'r',
    threadId: 't',
    timestamp: 1,
    usage,
  };
  // This scripted adapter reads only fixtureChunks, not an SDK logger.
  for await (const _chunk of adapter.chatStream({
    model: 'dummy-model',
    threadId: 'fixture',
    logger: undefined as never,
    messages: [],
    modelOptions: {
      fixtureChunks: [terminal, ...(duplicate ? [duplicate] : [])],
    },
  })) {
  }
}

describe('completion call instrumentation', () => {
  test('nullable schema compatibility keeps literal and annotation data unchanged', async () => {
    const value = { type: ['string', 'null'] };
    const metadata = {
      const: value,
      default: value,
      examples: [value],
      custom: value,
    };
    const output = { value, nullable: null };
    mockChat.mockResolvedValue(output);
    const result = await callLlm(
      { adapter: dummyAdapter },
      'offline',
      z.object({
        value: z.unknown().meta(metadata),
        nullable: z.string().nullable(),
      }),
      [],
      context().ctx,
    );
    expect(result.ok).toBe(true);
    expect(chatCall(0).outputSchema).toMatchObject({
      properties: {
        value: metadata,
        nullable: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      },
    });
  });

  test('keeps completion calls in their session without sharing threads across sessions', async () => {
    mockChat.mockResolvedValue({ userMessage: 'Done.' });
    for (const [index, session] of [
      'session-1',
      'session-1',
      'session-2',
    ].entries()) {
      const input = {
        ...makeInput(makeRequest('hide the tasks')),
        messageId: MessageId(`req-${index}`),
        sessionId: SessionId(session),
      };
      expect((await complete(makeContext(input))).ok).toBe(true);
      expect(chatCall(index).threadId).toBe(session);
    }
  });

  test('counts a failed provider run once when terminal usage is repeated', async () => {
    mockChat.mockImplementationOnce(async ({ adapter }) => {
      await reportUsage(
        adapter,
        {
          promptTokens: 12,
          completionTokens: 3,
          totalTokens: 15,
        },
        {
          type: 'RUN_ERROR' as RunErrorEvent['type'],
          message: 'private-provider-key',
          timestamp: 2,
          usage: [{ inputTokens: 12, outputTokens: 3, totalTokens: 15 }],
        },
      );
      throw new Error('private-provider-key');
    });
    const { ctx, events } = context();
    expect(await complete(ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'ProviderError' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.attributes).toMatchObject({
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 3,
      'maelstrom.outcome': 'error',
    });
    expect(JSON.stringify(events)).not.toContain('private-provider-key');
  });

  test('forwards midflight cancellation so unused provider work stops', async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    mockChat.mockImplementationOnce(async ({ abortController }) => {
      providerSignal = abortController.signal;
      controller.abort('superseded');
      throw new DOMException('aborted', 'AbortError');
    });
    const { ctx, events } = context(controller.signal);
    expect(await complete(ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'CancellationError', reason: 'superseded' },
    });
    expect(providerSignal?.aborted).toBe(true);
    expect(providerSignal?.reason).toBe('superseded');
    expect(events).toHaveLength(1);
    expect(events[0]?.attributes['maelstrom.outcome']).toBe('cancelled');
  });
  test('includes all reported usage in one correlated event without private content', async () => {
    mockChat.mockImplementationOnce(async ({ adapter }) => {
      for (const usage of [
        { promptTokens: 12, completionTokens: 3, totalTokens: 15 },
        { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
      ])
        await reportUsage(adapter, usage);
      return { userMessage: 'private output' };
    });
    const { ctx, events } = context();
    expect((await complete(ctx)).ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe('llm.call');
    expect(events[0]?.attributes).toEqual({
      'gen_ai.request.model': 'dummy-model',
      'gen_ai.usage.input_tokens': 16,
      'gen_ai.usage.output_tokens': 5,
      'maelstrom.message_id': 'req-1',
      'maelstrom.session_id': ctx.origin.sessionId,
      'maelstrom.outcome': 'ok',
      'maelstrom.latency_ms': expect.any(Number),
    });
  });

  test('does not fabricate zero usage when the provider reports none', async () => {
    mockChat.mockResolvedValueOnce({ userMessage: 'Done.' });
    const { ctx, events } = context();
    await complete(ctx);
    expect(events).toHaveLength(1);
    expect(events[0]?.attributes).not.toHaveProperty(
      'gen_ai.usage.input_tokens',
    );
    expect(events[0]?.attributes).not.toHaveProperty(
      'gen_ai.usage.output_tokens',
    );
  });

  test('preserves an explicit zero measurement instead of treating it as missing', async () => {
    mockChat.mockImplementationOnce(async ({ adapter }) => {
      await reportUsage(adapter, {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
      return { userMessage: 'Done.' };
    });
    const { ctx, events } = context();
    await complete(ctx);
    expect(events[0]?.attributes).toMatchObject({
      'gen_ai.usage.input_tokens': 0,
      'gen_ai.usage.output_tokens': 0,
    });
  });

  test('reports pre-flight cancellation without starting paid provider work', async () => {
    const controller = new AbortController();
    controller.abort('superseded');
    const { ctx, events } = context(controller.signal);
    expect(await complete(ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'CancellationError' },
    });
    expect(mockChat).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]?.attributes['maelstrom.outcome']).toBe('cancelled');
    expect(events[0]?.attributes).not.toHaveProperty(
      'gen_ai.usage.input_tokens',
    );
  });

  test('retains usage on a failure without exposing the provider error', async () => {
    mockChat.mockImplementationOnce(async ({ adapter }) => {
      await reportUsage(adapter, {
        promptTokens: 12,
        completionTokens: 3,
        totalTokens: 15,
      });
      throw new Error('private-provider-key');
    });
    const { ctx, events } = context();
    expect(await complete(ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'ProviderError' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.attributes).toMatchObject({
      'gen_ai.usage.input_tokens': 12,
      'gen_ai.usage.output_tokens': 3,
      'maelstrom.outcome': 'error',
    });
    expect(JSON.stringify(events)).not.toContain('private-provider-key');
  });

  test('rejects a late cancelled response and reports the actual planner outcome', async () => {
    const controller = new AbortController();
    mockChat.mockImplementationOnce(async ({ adapter }) => {
      await reportUsage(adapter, {
        promptTokens: 12,
        completionTokens: 3,
        totalTokens: 15,
      });
      controller.abort('superseded');
      return { userMessage: 'Done.' };
    });
    const { ctx, events } = context(controller.signal);
    expect(await complete(ctx)).toMatchObject({
      ok: false,
      error: { _tag: 'CancellationError', reason: 'superseded' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.attributes).toMatchObject({
      'gen_ai.usage.input_tokens': 12,
      'maelstrom.outcome': 'cancelled',
    });
  });

  test('does not share usage between concurrent requests on one adapter', async () => {
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockChat.mockImplementationOnce(async ({ adapter }) => {
      await reportUsage(adapter, {
        promptTokens: 12,
        completionTokens: 3,
        totalTokens: 15,
      });
      await barrier;
      return { userMessage: 'First.' };
    });
    mockChat.mockImplementationOnce(async ({ adapter }) => {
      await reportUsage(adapter, {
        promptTokens: 40,
        completionTokens: 10,
        totalTokens: 50,
      });
      release();
      return { userMessage: 'Second.' };
    });
    const first = context(undefined, 'first');
    const second = context(undefined, 'second');
    await Promise.all([complete(first.ctx), complete(second.ctx)]);
    expect(first.events[0]?.attributes).toMatchObject({
      'maelstrom.message_id': 'first',
      'gen_ai.usage.input_tokens': 12,
    });
    expect(second.events[0]?.attributes).toMatchObject({
      'maelstrom.message_id': 'second',
      'gen_ai.usage.input_tokens': 40,
    });
  });
});
