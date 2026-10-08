import { describe, expect, test } from 'bun:test';

import type { AnyTextAdapter, StreamChunk } from '@tanstack/ai';

import { type LlmCall, withUsage } from './usage-adapter.js';

const usage = { promptTokens: 120, completionTokens: 30, totalTokens: 150 };

class FakeAdapter {
  readonly kind = 'text';
  readonly name = 'fake';
  readonly model = 'fake-model';
  readonly #chunks: readonly StreamChunk[];
  constructor(chunks: readonly StreamChunk[]) {
    this.#chunks = chunks;
  }
  async *chatStream() {
    yield* this.#chunks;
  }
  async *structuredOutputStream() {
    yield* this.#chunks;
  }
  async structuredOutput() {
    return { data: { ok: true }, rawText: '{"ok":true}', usage };
  }
  supportsCombinedToolsAndSchema() {
    return this.#chunks.length > 0;
  }
}

const finished = [
  { type: 'RUN_STARTED', runId: 'r', threadId: 't', timestamp: 1 },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: '{}', timestamp: 2 },
  {
    type: 'RUN_FINISHED',
    runId: 'r',
    threadId: 't',
    timestamp: 3,
    finishReason: 'stop',
    usage,
  },
] as unknown as StreamChunk[];

function wrap(inner: FakeAdapter | Record<string, unknown>) {
  const calls: LlmCall[] = [];
  const adapter = withUsage(
    inner as unknown as AnyTextAdapter,
    'complete',
    (call) => calls.push(call),
  );
  return { adapter, calls };
}

async function drain(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('withUsage', () => {
  test('records a streamed call once, with the finishing chunk’s usage', async () => {
    const { adapter, calls } = wrap(new FakeAdapter(finished));
    const structuredOutputStream = adapter.structuredOutputStream;
    if (!structuredOutputStream) throw new Error('method missing');
    const chunks = await drain(
      structuredOutputStream({ chatOptions: {}, outputSchema: {} } as never),
    );
    expect(chunks).toEqual(finished);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      role: 'complete',
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    });
    expect(calls[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('records chatStream and structuredOutput calls too', async () => {
    const { adapter, calls } = wrap(new FakeAdapter(finished));
    await drain(adapter.chatStream({} as never));
    const result = await adapter.structuredOutput({} as never);
    expect(result.data).toEqual({ ok: true });
    expect(calls.map((call) => call.usage?.inputTokens)).toEqual([120, 120]);
  });

  test('includes every AG-UI usage entry so evaluation totals do not undercount model work', async () => {
    const chunks = finished.map((chunk) =>
      chunk.type === 'RUN_FINISHED'
        ? {
            ...chunk,
            usage: [
              { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
              { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
            ],
          }
        : chunk,
    );
    const { adapter, calls } = wrap(new FakeAdapter(chunks));
    expect(await drain(adapter.chatStream({} as never))).toEqual(chunks);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.usage).toEqual({
      inputTokens: 160,
      outputTokens: 40,
      totalTokens: 200,
    });
  });

  test('does not report missing provider usage as zero token work', async () => {
    const { adapter, calls } = wrap(
      new FakeAdapter(
        finished.map((chunk) =>
          chunk.type === 'RUN_FINISHED' ? { ...chunk, usage: [] } : chunk,
        ),
      ),
    );
    await drain(adapter.chatStream({} as never));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.usage).toBeUndefined();
  });

  test('records a call without usage, and one that stops early', async () => {
    const { adapter, calls } = wrap(
      new FakeAdapter(finished.slice(0, 2) as StreamChunk[]),
    );
    await drain(adapter.chatStream({} as never));
    for await (const _chunk of adapter.chatStream({} as never)) break;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.usage).toBe(undefined);
  });

  test('keeps the adapter’s shape and binds its methods', () => {
    const { adapter } = wrap(new FakeAdapter(finished));
    expect(adapter.model).toBe('fake-model');
    expect(adapter.name).toBe('fake');
    expect(adapter.supportsCombinedToolsAndSchema?.()).toBe(true);
    const bare = wrap({
      kind: 'text',
      name: 'bare',
      model: 'm',
      chatStream: () => [],
      structuredOutput: async () => ({ data: 1, rawText: '1' }),
    });
    expect(bare.adapter.structuredOutputStream).toBe(undefined);
  });
});
