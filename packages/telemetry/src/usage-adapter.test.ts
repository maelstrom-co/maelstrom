import { describe, expect, test } from 'bun:test';

import type { AnyTextAdapter, StreamChunk } from '@tanstack/ai';

import {
  createUsageLedger,
  type ProviderCallRecord,
  totalTokens,
  withUsage,
} from './usage-adapter.js';

const usage = { promptTokens: 120, completionTokens: 30, totalTokens: 150 };

class FakeAdapter {
  readonly kind = 'text';
  readonly name = 'fake';
  readonly model: string;
  readonly #chunks: readonly StreamChunk[];
  constructor(chunks: readonly StreamChunk[], model = 'fake-model') {
    this.#chunks = chunks;
    this.model = model;
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

describe('withUsage', () => {
  test.each([
    {
      name: 'aggregate counters',
      reported: {
        ...usage,
        promptTokensDetails: { cachedTokens: 80, cacheWriteTokens: 20 },
        cost: 0.012,
      },
      expected: {
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        cachedInputTokens: 80,
        cacheWriteInputTokens: 20,
        cost: 0.012,
      },
    },
    {
      name: 'AG-UI entries with duplicated cache-write leftovers',
      reported: [
        {
          inputTokens: 100,
          outputTokens: 20,
          cachedInputTokens: 60,
          cacheWriteInputTokens: 10,
        },
        {
          inputTokens: 20,
          outputTokens: 10,
          cachedInputTokens: 20,
          cacheWriteInputTokens: 10,
        },
      ],
      leftover: {
        promptTokensDetails: { cacheWriteTokens: 20 },
        cost: 0.012,
        providerUsageDetails: { secret: 'private-key' },
      },
      expected: {
        inputTokens: 120,
        outputTokens: 30,
        cachedInputTokens: 80,
        cacheWriteInputTokens: 20,
        cost: 0.012,
      },
    },
    {
      name: 'metadata-only usage',
      reported: undefined,
      leftover: {
        promptTokensDetails: { cachedTokens: 80, cacheWriteTokens: 20 },
        cost: 0.012,
      },
      expected: {
        cachedInputTokens: 80,
        cacheWriteInputTokens: 20,
        cost: 0.012,
      },
    },
    {
      name: 'reported zero is not missing',
      reported: [{ cachedInputTokens: 0, cacheWriteInputTokens: 0 }],
      leftover: { cost: 0 },
      expected: { cachedInputTokens: 0, cacheWriteInputTokens: 0, cost: 0 },
    },
    {
      name: 'unknown cache and cost remain absent',
      reported: usage,
      expected: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    },
    {
      name: 'invalid values cannot poison usage sums',
      reported: [{ cachedInputTokens: Number.NaN, cacheWriteInputTokens: -1 }],
      leftover: { cost: Number.POSITIVE_INFINITY },
      expected: undefined,
    },
  ])(
    'preserves cache accounting without inflating input tokens: $name',
    async ({ reported, leftover, expected }) => {
      const terminal = {
        type: 'RUN_FINISHED',
        runId: 'r',
        threadId: 't',
        timestamp: 1,
        usage: reported,
        metadata: { tanstack: { usage: leftover } },
      } as unknown as StreamChunk;
      const { adapter, calls } = wrap(new FakeAdapter([terminal, terminal]));
      await drain(adapter.chatStream({} as never));
      expect(calls).toHaveLength(1);
      expect(calls[0]?.usage).toEqual(expected);
      expect(JSON.stringify(calls)).not.toContain('private-key');
    },
  );

  test('direct structured output retains cache counters and quoted cost too', async () => {
    const { adapter, calls } = wrap({
      model: 'direct-model',
      async structuredOutput() {
        return {
          data: { ok: true },
          rawText: '{}',
          usage: {
            ...usage,
            promptTokensDetails: { cachedTokens: 80, cacheWriteTokens: 20 },
            cost: 0,
          },
        };
      },
    });
    await adapter.structuredOutput({} as never);
    expect(calls[0]?.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      cachedInputTokens: 80,
      cacheWriteInputTokens: 20,
      cost: 0,
    });
    expect(calls[0]?.completed).toBe(true);
  });

  test('records a failed structured output call as incomplete', async () => {
    const { adapter, calls } = wrap({
      model: 'direct-model',
      async structuredOutput() {
        throw new Error('provider down');
      },
    });
    await expect(adapter.structuredOutput({} as never)).rejects.toThrow(
      'provider down',
    );
    expect(calls).toEqual([
      {
        role: 'complete',
        model: 'direct-model',
        latencyMs: expect.any(Number),
        completed: false,
      },
    ]);
  });

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
      completed: true,
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

  test('includes every AG-UI usage entry so totals do not undercount model work', async () => {
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
    expect(calls[0]).not.toHaveProperty('usage');
  });

  test.each([
    { entries: [{}], expected: undefined },
    {
      entries: [{ provider: 'offline', model: 'offline' }],
      expected: undefined,
    },
    { entries: [{ inputTokens: 7 }], expected: { inputTokens: 7 } },
    { entries: [{ outputTokens: 0 }], expected: { outputTokens: 0 } },
    { entries: [{ totalTokens: 3 }], expected: { totalTokens: 3 } },
    {
      entries: [{ inputTokens: 7 }, { outputTokens: 3, totalTokens: 10 }],
      expected: { inputTokens: 7, outputTokens: 3, totalTokens: 10 },
    },
  ])(
    'keeps unreported counters absent in call records: $entries',
    async ({ entries, expected }) => {
      const chunks = finished.map((chunk) =>
        chunk.type === 'RUN_FINISHED'
          ? { ...chunk, usage: [...entries] }
          : chunk,
      );
      const { adapter, calls } = wrap(new FakeAdapter(chunks));
      expect(await drain(adapter.chatStream({} as never))).toEqual(chunks);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.usage).toEqual(expected);
    },
  );

  test('records a call without usage, and one that stops early', async () => {
    const { adapter, calls } = wrap(
      new FakeAdapter(finished.slice(0, 2) as StreamChunk[]),
    );
    await drain(adapter.chatStream({} as never));
    for await (const _chunk of adapter.chatStream({} as never)) break;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.usage).toBe(undefined);
  });

  test('retains failed-call usage without adding a repeated terminal snapshot', async () => {
    const failed = {
      type: 'RUN_ERROR',
      runId: 'r',
      threadId: 't',
      timestamp: 4,
      message: 'synthetic failure',
      usage: [{ inputTokens: 120, outputTokens: 30, totalTokens: 150 }],
    } as unknown as StreamChunk;
    const chunks = [finished[0]!, failed, failed, { ...failed, usage: [] }];
    const { adapter, calls } = wrap(new FakeAdapter(chunks));
    expect(await drain(adapter.chatStream({} as never))).toEqual(chunks);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    });
    expect(calls[0]?.completed).toBe(false);
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

  test('wraps a frozen adapter whose methods are its own properties', async () => {
    const { adapter, calls } = wrap(
      Object.freeze({
        kind: 'text',
        name: 'frozen',
        model: 'frozen-model',
        async *chatStream() {
          yield* finished;
        },
        async structuredOutput() {
          return { data: { ok: true }, rawText: '{"ok":true}', usage };
        },
      }),
    );
    expect(await adapter.structuredOutput({} as never)).toEqual({
      data: { ok: true },
      rawText: '{"ok":true}',
      usage,
    });
    expect(await drain(adapter.chatStream({} as never))).toEqual(finished);
    expect(calls.map((call) => [call.model, call.completed])).toEqual([
      ['frozen-model', true],
      ['frozen-model', true],
    ]);
    expect(calls.map((call) => call.usage)).toEqual([
      { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    ]);
  });

  test('labels each record with the role it was wrapped with', async () => {
    const records: ProviderCallRecord<'agent' | 'grader'>[] = [];
    const adapter = withUsage(
      new FakeAdapter(finished) as unknown as AnyTextAdapter,
      'agent',
      (call) => records.push(call),
    );
    await drain(adapter.chatStream({} as never));
    expect(records.map((record) => record.role)).toEqual(['agent']);
  });
});

describe('createUsageLedger', () => {
  test('sums every turn of a multi-turn run, not only the final turn', async () => {
    const ledger = createUsageLedger<'agent'>();
    const adapter = withUsage(
      scripted([
        terminal('RUN_FINISHED', 8, 4),
        terminal('RUN_FINISHED', 3, 2),
      ]),
      'agent',
      ledger.record,
    );
    await drain(adapter.chatStream({} as never));
    await drain(adapter.chatStream({} as never));
    const snapshot = ledger.snapshot();
    expect(snapshot.calls).toBe(2);
    expect(snapshot.usage).toEqual({ inputTokens: 11, outputTokens: 6 });
    expect(totalTokens(snapshot)).toBe(17);
  });

  test('counts a structured output finalization call as its own record', async () => {
    const ledger = createUsageLedger<'agent'>();
    const adapter = withUsage(
      scripted(
        [terminal('RUN_FINISHED', 8, 4), terminal('RUN_FINISHED', 3, 2)],
        { promptTokens: 2, completionTokens: 1 },
      ),
      'agent',
      ledger.record,
    );
    await drain(adapter.chatStream({} as never));
    await drain(adapter.chatStream({} as never));
    await adapter.structuredOutput({} as never);
    const snapshot = ledger.snapshot();
    expect(snapshot.calls).toBe(3);
    expect(totalTokens(snapshot)).toBe(20);
  });

  test('keeps the usage of a failed turn next to earlier turns', async () => {
    const ledger = createUsageLedger<'agent'>();
    const records: ProviderCallRecord<'agent'>[] = [];
    const adapter = withUsage(
      scripted([terminal('RUN_FINISHED', 8, 4), terminal('RUN_ERROR', 5, 2)]),
      'agent',
      (call) => {
        records.push(call);
        ledger.record(call);
      },
    );
    await drain(adapter.chatStream({} as never));
    await drain(adapter.chatStream({} as never));
    expect(records.map((record) => record.completed)).toEqual([true, false]);
    expect(records[1]?.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(totalTokens(ledger.snapshot())).toBe(19);
  });

  test('keeps concurrent roles apart and never turns a missing counter into zero', async () => {
    const ledger = createUsageLedger<'agent' | 'grader'>();
    const agent = withUsage(
      scripted([terminal('RUN_FINISHED', 10, 0)]),
      'agent',
      ledger.record,
    );
    const grader = withUsage(
      scripted([finished[2]!, { ...finished[2]!, usage: [] } as StreamChunk]),
      'grader',
      ledger.record,
    );
    const agentStream = agent.chatStream({} as never)[Symbol.asyncIterator]();
    const graderStream = grader.chatStream({} as never)[Symbol.asyncIterator]();
    await graderStream.next();
    while (!(await agentStream.next()).done);
    while (!(await graderStream.next()).done);
    await drain(grader.chatStream({} as never));

    expect(ledger.snapshot({ role: 'agent' })).toEqual({
      calls: 1,
      unreportedCalls: 0,
      rateLimitedCalls: 0,
      completedWithoutUsage: 0,
      partialUsageCalls: 0,
      usage: { inputTokens: 10, outputTokens: 0 },
    });
    const graded = ledger.snapshot({ role: 'grader' });
    expect(graded).toEqual({
      calls: 2,
      unreportedCalls: 1,
      rateLimitedCalls: 0,
      completedWithoutUsage: 1,
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      partialUsageCalls: 0,
    });
    expect(totalTokens(ledger.snapshot({ role: 'agent' }))).toBe(10);
    expect(totalTokens(graded)).toBeUndefined();
    expect(totalTokens(ledger.snapshot())).toBeUndefined();
  });

  test('reports an empty ledger as zero spent tokens with no counters', () => {
    const snapshot = createUsageLedger().snapshot();
    expect(snapshot).toEqual({
      calls: 0,
      unreportedCalls: 0,
      rateLimitedCalls: 0,
      completedWithoutUsage: 0,
      partialUsageCalls: 0,
      usage: {},
    });
    expect(totalTokens(snapshot)).toBe(0);
  });

  test('treats a total as unknown when one side was never reported', () => {
    const ledger = createUsageLedger<'agent'>();
    ledger.record({
      role: 'agent',
      model: 'm',
      latencyMs: 1,
      completed: true,
      usage: { inputTokens: 9 },
    });
    expect(ledger.snapshot().usage).toEqual({ inputTokens: 9 });
    expect(ledger.snapshot().usage).not.toHaveProperty('outputTokens');
    expect(totalTokens(ledger.snapshot())).toBeUndefined();
  });

  test('counts every retry attempt of one logical iteration', async () => {
    const ledger = createUsageLedger<'agent'>();
    const adapter = withUsage(
      scripted([terminal('RUN_ERROR', 3, 1), terminal('RUN_FINISHED', 4, 2)]),
      'agent',
      ledger.record,
    );
    await drain(adapter.chatStream({} as never));
    await drain(adapter.chatStream({} as never));
    const snapshot = ledger.snapshot();
    expect(snapshot.calls).toBe(2);
    expect(totalTokens(snapshot)).toBe(10);
  });

  test('copies records so later mutation of a snapshot cannot change the ledger', () => {
    const ledger = createUsageLedger<'agent'>();
    ledger.record({
      role: 'agent',
      model: 'm',
      latencyMs: 1,
      completed: true,
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const first = ledger.snapshot();
    (first.usage as { inputTokens?: number }).inputTokens = 99;
    expect(ledger.snapshot().usage.inputTokens).toBe(1);
  });
});

describe('model per call', () => {
  test('names the terminal chunk’s model, else the adapter’s model', async () => {
    const { adapter, calls } = wrap(
      scripted([
        terminal('RUN_FINISHED', 1, 1, { model: 'served-model' }),
        terminal('RUN_FINISHED', 1, 1),
      ]),
    );
    await drain(adapter.chatStream({} as never));
    await drain(adapter.chatStream({} as never));
    await adapter.structuredOutput({} as never);
    expect(calls.map((call) => call.model)).toEqual([
      'served-model',
      'scripted-model',
      'scripted-model',
    ]);
  });

  test('names the model a structured output result reports', async () => {
    const { adapter, calls } = wrap({
      model: 'configured',
      async structuredOutput() {
        return { data: 1, rawText: '1', model: 'served' };
      },
    });
    await adapter.structuredOutput({} as never);
    expect(calls[0]?.model).toBe('served');
  });

  test('a delegating adapter that picks an inner adapter per call names each inner model', async () => {
    const fast = new FakeAdapter(
      [terminal('RUN_FINISHED', 1, 1, { model: 'fast-model' })],
      'fast-model',
    );
    const deep = new FakeAdapter(
      [terminal('RUN_FINISHED', 5, 5, { model: 'deep-model' })],
      'deep-model',
    );
    const picks = [fast, deep, fast];
    const delegating = {
      kind: 'text',
      name: 'delegating',
      model: 'delegating',
      chatStream() {
        const inner = picks.shift();
        if (!inner) throw new Error('no inner adapter left');
        return inner.chatStream();
      },
      structuredOutput: async () => ({ data: 1, rawText: '1' }),
    };
    const { adapter, calls } = wrap(delegating);
    for (let turn = 0; turn < 3; turn++)
      await drain(adapter.chatStream({} as never));
    expect(calls.map((call) => call.model)).toEqual([
      'fast-model',
      'deep-model',
      'fast-model',
    ]);
  });
});

describe('completion flag', () => {
  test('a finished stream without usage is complete and counts as completed without usage', async () => {
    const ledger = createUsageLedger<'complete'>();
    const adapter = withUsage(
      scripted([terminal('RUN_FINISHED', 0, 0, { usage: undefined })]),
      'complete',
      ledger.record,
    );
    await drain(adapter.chatStream({} as never));
    expect(ledger.snapshot()).toEqual({
      calls: 1,
      unreportedCalls: 1,
      rateLimitedCalls: 0,
      completedWithoutUsage: 1,
      partialUsageCalls: 0,
      usage: {},
    });
  });

  test('a consumer that stops pulling mid-stream yields one incomplete record', async () => {
    const { adapter, calls } = wrap(new FakeAdapter(finished));
    for await (const chunk of adapter.chatStream({} as never))
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') break;
    expect(calls).toEqual([
      {
        role: 'complete',
        model: 'fake-model',
        latencyMs: expect.any(Number),
        completed: false,
      },
    ]);
    const ledger = createUsageLedger<'complete'>();
    for (const call of calls) ledger.record(call);
    expect(ledger.snapshot()).toMatchObject({
      unreportedCalls: 1,
      rateLimitedCalls: 0,
      completedWithoutUsage: 0,
    });
  });

  test('a chatStream that throws synchronously yields one incomplete record and rethrows', async () => {
    const { adapter, calls } = wrap({
      kind: 'text',
      name: 'eager',
      model: 'eager-model',
      chatStream() {
        throw new Error('no inner adapter left');
      },
    });
    await expect(
      (async () => drain(adapter.chatStream({} as never)))(),
    ).rejects.toThrow('no inner adapter left');
    expect(calls).toEqual([
      {
        role: 'complete',
        model: 'eager-model',
        latencyMs: expect.any(Number),
        completed: false,
      },
    ]);
  });

  test('a structuredOutput that throws synchronously yields one incomplete record and rethrows', async () => {
    const { adapter, calls } = wrap({
      kind: 'text',
      name: 'eager',
      model: 'eager-model',
      structuredOutput() {
        throw new Error('no inner adapter left');
      },
    });
    await expect(
      (async () => adapter.structuredOutput({} as never))(),
    ).rejects.toThrow('no inner adapter left');
    expect(calls).toEqual([
      {
        role: 'complete',
        model: 'eager-model',
        latencyMs: expect.any(Number),
        completed: false,
      },
    ]);
  });

  test('an aborted stream yields one incomplete record without usage', async () => {
    const controller = new AbortController();
    const aborting = {
      kind: 'text',
      name: 'aborting',
      model: 'abort-model',
      async *chatStream(options: { abortController?: AbortController }) {
        yield finished[0]!;
        const signal = options.abortController?.signal;
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        });
        yield finished[2]!;
      },
      structuredOutput: async () => ({ data: 1, rawText: '1' }),
    };
    const { adapter, calls } = wrap(aborting);
    const stream = adapter.chatStream({
      abortController: controller,
    } as never);
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    const pending = iterator.next();
    controller.abort(new Error('aborted'));
    await expect(pending).rejects.toThrow('aborted');
    expect(calls).toEqual([
      {
        role: 'complete',
        model: 'abort-model',
        latencyMs: expect.any(Number),
        completed: false,
      },
    ]);
  });
});

describe('throwing sink', () => {
  const throwingSink = (calls: ProviderCallRecord<'complete'>[]) => {
    return (call: ProviderCallRecord<'complete'>) => {
      calls.push(call);
      throw new Error('sink');
    };
  };

  test('a failed structuredOutput rejects with the provider error, not the sink error', async () => {
    const calls: ProviderCallRecord<'complete'>[] = [];
    const adapter = withUsage(
      {
        kind: 'text',
        name: 'failing',
        model: 'failing-model',
        async structuredOutput() {
          throw new Error('provider');
        },
      } as unknown as AnyTextAdapter,
      'complete',
      throwingSink(calls),
    );
    await expect(adapter.structuredOutput({} as never)).rejects.toThrow(
      'provider',
    );
    expect(calls).toHaveLength(1);
  });

  test('a failed chatStream rejects with the provider error, not the sink error', async () => {
    const calls: ProviderCallRecord<'complete'>[] = [];
    const adapter = withUsage(
      {
        kind: 'text',
        name: 'failing',
        model: 'failing-model',
        async *chatStream() {
          yield finished[0]!;
          throw new Error('provider');
        },
        structuredOutput: async () => ({ data: 1, rawText: '1' }),
      } as unknown as AnyTextAdapter,
      'complete',
      throwingSink(calls),
    );
    const chunks: StreamChunk[] = [];
    await expect(
      (async () => {
        for await (const chunk of adapter.chatStream({} as never))
          chunks.push(chunk);
      })(),
    ).rejects.toThrow('provider');
    expect(chunks).toEqual([finished[0]!]);
    expect(calls).toHaveLength(1);
  });

  test('a successful call still returns its result', async () => {
    const calls: ProviderCallRecord<'complete'>[] = [];
    const adapter = withUsage(
      new FakeAdapter(finished) as unknown as AnyTextAdapter,
      'complete',
      throwingSink(calls),
    );
    await expect(adapter.structuredOutput({} as never)).resolves.toEqual({
      data: { ok: true },
      rawText: '{"ok":true}',
      usage,
    });
    expect(await drain(adapter.chatStream({} as never))).toEqual(finished);
    expect(calls).toHaveLength(2);
  });
});

function wrap(inner: FakeAdapter | AnyTextAdapter | Record<string, unknown>) {
  const calls: ProviderCallRecord<'complete'>[] = [];
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

function terminal(
  type: 'RUN_FINISHED' | 'RUN_ERROR',
  inputTokens: number,
  outputTokens: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    type,
    runId: 'r',
    threadId: 't',
    timestamp: 1,
    message: type === 'RUN_ERROR' ? 'synthetic failure' : undefined,
    usage: [{ inputTokens, outputTokens }],
    ...overrides,
  } as unknown as StreamChunk;
}

function scripted(
  terminals: readonly StreamChunk[],
  structuredUsage?: { promptTokens: number; completionTokens: number },
): AnyTextAdapter {
  const queue = [...terminals];
  return {
    kind: 'text',
    name: 'scripted',
    model: 'scripted-model',
    async *chatStream() {
      yield finished[0]!;
      const next = queue.shift();
      if (next) yield next;
    },
    async structuredOutput() {
      return { data: {}, rawText: '{}', usage: structuredUsage };
    },
  } as unknown as AnyTextAdapter;
}

describe('partial usage', () => {
  const call = (
    role: 'agent' | 'grader',
    usage?: ProviderCallRecord['usage'],
  ): ProviderCallRecord<'agent' | 'grader'> => ({
    role,
    model: 'm',
    latencyMs: 1,
    completed: true,
    ...(usage && { usage }),
  });

  test('a call missing a counter makes the total unknown instead of undercounting', () => {
    const ledger = createUsageLedger<'agent' | 'grader'>();
    ledger.record(call('agent', { inputTokens: 10, outputTokens: 5 }));
    ledger.record(call('agent', { inputTokens: 7 }));
    const snapshot = ledger.snapshot();
    expect(snapshot.partialUsageCalls).toBe(1);
    expect(snapshot.unreportedCalls).toBe(0);
    expect(snapshot.usage).toEqual({ inputTokens: 17, outputTokens: 5 });
    expect(totalTokens(snapshot)).toBeUndefined();
  });

  test('an explicit zero counter is not partial', () => {
    const ledger = createUsageLedger<'agent' | 'grader'>();
    ledger.record(call('agent', { inputTokens: 7, outputTokens: 0 }));
    const snapshot = ledger.snapshot();
    expect(snapshot.partialUsageCalls).toBe(0);
    expect(totalTokens(snapshot)).toBe(7);
  });

  test('a call without usage is unreported, not partial', () => {
    const ledger = createUsageLedger<'agent' | 'grader'>();
    ledger.record(call('agent'));
    const snapshot = ledger.snapshot();
    expect(snapshot.unreportedCalls).toBe(1);
    expect(snapshot.partialUsageCalls).toBe(0);
  });

  test('the role filter applies to partial calls', () => {
    const ledger = createUsageLedger<'agent' | 'grader'>();
    ledger.record(call('agent', { inputTokens: 10, outputTokens: 5 }));
    ledger.record(call('grader', { inputTokens: 7 }));
    expect(ledger.snapshot({ role: 'agent' }).partialUsageCalls).toBe(0);
    expect(totalTokens(ledger.snapshot({ role: 'agent' }))).toBe(15);
    expect(ledger.snapshot({ role: 'grader' }).partialUsageCalls).toBe(1);
    expect(totalTokens(ledger.snapshot({ role: 'grader' }))).toBeUndefined();
  });
});

describe('rate-limited calls', () => {
  const started = finished[0]!;
  const rateLimitError = (overrides: Record<string, unknown> = {}) =>
    ({
      type: 'RUN_ERROR',
      runId: 'r',
      threadId: 't',
      timestamp: 2,
      message: 'rate limited',
      ...overrides,
    }) as unknown as StreamChunk;

  test('a refusal with retryAfterMs before any output is marked rate-limited', async () => {
    const { adapter, calls } = wrap(
      new FakeAdapter([started, rateLimitError({ retryAfterMs: 0 })]),
    );
    await drain(adapter.chatStream({} as never));
    expect(calls).toEqual([
      {
        role: 'complete',
        model: 'fake-model',
        latencyMs: expect.any(Number),
        completed: false,
        rateLimited: true,
      },
    ]);
  });

  test('output before the error leaves the call unmarked', async () => {
    const { adapter, calls } = wrap(
      new FakeAdapter([
        started,
        finished[1]!,
        rateLimitError({ retryAfterMs: 0 }),
      ]),
    );
    await drain(adapter.chatStream({} as never));
    expect(calls[0]).not.toHaveProperty('rateLimited');
  });

  test('an error without retryAfterMs stays unreported', async () => {
    const { adapter, calls } = wrap(
      new FakeAdapter([started, rateLimitError()]),
    );
    await drain(adapter.chatStream({} as never));
    expect(calls[0]).not.toHaveProperty('rateLimited');
    const ledger = createUsageLedger<'complete'>();
    for (const call of calls) ledger.record(call);
    expect(ledger.snapshot()).toMatchObject({
      unreportedCalls: 1,
      rateLimitedCalls: 0,
    });
    expect(totalTokens(ledger.snapshot())).toBeUndefined();
  });

  test('a rate-limited record without usage counts as zero spend', () => {
    const ledger = createUsageLedger<'agent'>();
    const call = { role: 'agent', model: 'm', latencyMs: 1 } as const;
    ledger.record({ ...call, completed: false, rateLimited: true });
    expect(totalTokens(ledger.snapshot())).toBe(0);
    ledger.record({
      ...call,
      completed: true,
      usage: { inputTokens: 4, outputTokens: 1 },
    });
    const snapshot = ledger.snapshot();
    expect(snapshot).toMatchObject({
      calls: 2,
      unreportedCalls: 0,
      rateLimitedCalls: 1,
    });
    expect(totalTokens(snapshot)).toBe(5);
  });
});
