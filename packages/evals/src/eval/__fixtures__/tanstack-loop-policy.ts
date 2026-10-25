import assert from 'node:assert/strict';
import {
  type ChatMiddleware,
  chat,
  maxIterations,
  type StreamChunk,
  type TextOptions,
  type TokenUsage,
  toolDefinition,
} from '@tanstack/ai';
import { toolCacheMiddleware } from '@tanstack/ai/middlewares';
import { type FakeResponseStep, fakeText } from '@tanstack/ai/testing';
import { z } from 'zod';
import { type LlmCall, withUsage } from '../../core/usage-adapter.js';

let network = 0;
function forbidNetwork(): never {
  network++;
  throw new Error('Outbound requests are forbidden in this proof.');
}
globalThis.fetch = Object.assign(async () => forbidNetwork(), {
  preconnect: forbidNetwork,
});

async function drain(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function toolResults(chunks: StreamChunk[]) {
  return chunks.flatMap((chunk) =>
    chunk.type === 'TOOL_CALL_RESULT' ? [chunk.content] : [],
  );
}

async function cacheAuthorization() {
  let allowed = true;
  let executions = 0;
  let checks = 0;
  const aborts: (string | undefined)[] = [];
  const cache = toolCacheMiddleware({
    ttl: 60_000,
    toolNames: ['read_secret'],
  });
  const authorize: ChatMiddleware = {
    onBeforeToolCall: () => {
      checks++;
      if (!allowed) return { type: 'abort', reason: 'Permission denied.' };
      return undefined;
    },
    onAbort: (_ctx, info) => {
      aborts.push(info.reason);
    },
  };
  const tool = toolDefinition({
    name: 'read_secret',
    description: 'Read a principal-owned fixture.',
    outputSchema: z.object({ secret: z.string() }),
  }).server(() => {
    executions++;
    return { secret: 'alice' };
  });
  const adapter = fakeText();
  adapter.setResponses([
    { toolCalls: [{ name: 'read_secret' }] },
    { text: 'Done.' },
    { toolCalls: [{ name: 'read_secret' }] },
    { text: 'The cached secret.' },
  ]);
  const run = (threadId: string) =>
    drain(
      chat({
        adapter,
        threadId,
        messages: [{ role: 'user', content: 'Read my fixture.' }],
        tools: [tool],
        middleware: [authorize, cache],
        agentLoopStrategy: maxIterations(2),
        debug: false,
      }),
    );
  assert.deepEqual(toolResults(await run('alice')), ['{"secret":"alice"}']);
  allowed = false;
  const denied = await run('bob');
  assert.deepEqual(toolResults(denied), []);
  assert.equal(checks, 2);
  assert.equal(executions, 1);
  assert.equal(adapter.state.callCount, 3);
  assert.deepEqual(aborts, ['Permission denied.']);
  assert.equal(JSON.stringify(denied).includes('alice'), false);
  assert.equal(
    denied.filter(
      (chunk) => chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR',
    ).length,
    0,
  );
}

async function cacheBypassesGuard() {
  let allowed = true;
  let checks = 0;
  let executions = 0;
  const guard: ChatMiddleware = {
    onGuardToolCall: () => {
      checks++;
      if (!allowed) return { type: 'abort', reason: 'Permission denied.' };
      return undefined;
    },
  };
  const tool = toolDefinition({
    name: 'read_secret',
    description: 'Read a principal-owned fixture.',
    outputSchema: z.object({ secret: z.string() }),
  }).server(() => {
    executions++;
    return { secret: 'alice' };
  });
  const cache = toolCacheMiddleware({ toolNames: ['read_secret'] });
  const adapter = fakeText();
  adapter.setResponses([
    { toolCalls: [{ name: 'read_secret' }] },
    { toolCalls: [{ name: 'read_secret' }] },
  ]);
  const run = (threadId: string) =>
    drain(
      chat({
        adapter,
        threadId,
        messages: [{ role: 'user', content: 'Read my fixture.' }],
        tools: [tool],
        middleware: [guard, cache],
        agentLoopStrategy: maxIterations(1),
        debug: false,
      }),
    );
  await run('alice');
  allowed = false;
  assert.deepEqual(toolResults(await run('bob')), ['{"secret":"alice"}']);
  assert.equal(checks, 1);
  assert.equal(executions, 1);
}

async function cacheScopeAndFreshness() {
  let principal = 'alice';
  let revision = 1;
  let reads = 0;
  let writes = 0;
  let now = Date.now();
  const dateNow = Date.now;
  Date.now = () => now;
  try {
    const cache = toolCacheMiddleware({
      ttl: 1_000,
      toolNames: ['read_fixture'],
      keyFn: (name, args) => JSON.stringify([principal, revision, name, args]),
    });
    const read = toolDefinition({
      name: 'read_fixture',
      description: 'Read a revision-owned fixture.',
    }).server(() => ({ principal, revision, reads: ++reads }));
    const write = toolDefinition({
      name: 'write_fixture',
      description: 'Count an ordered fixture mutation.',
    }).server(() => ({ writes: ++writes }));
    const adapter = fakeText();
    const run = async (name: string) => {
      adapter.setResponses([{ toolCalls: [{ name }] }]);
      return toolResults(
        await drain(
          chat({
            adapter,
            threadId: principal,
            messages: [{ role: 'user', content: 'Read my fixture.' }],
            tools: [read, write],
            middleware: [cache],
            agentLoopStrategy: maxIterations(1),
            debug: false,
          }),
        ),
      );
    };
    assert.deepEqual(await run('read_fixture'), [
      '{"principal":"alice","revision":1,"reads":1}',
    ]);
    assert.deepEqual(await run('read_fixture'), [
      '{"principal":"alice","revision":1,"reads":1}',
    ]);
    principal = 'bob';
    assert.deepEqual(await run('read_fixture'), [
      '{"principal":"bob","revision":1,"reads":2}',
    ]);
    principal = 'alice';
    revision = 2;
    assert.deepEqual(await run('read_fixture'), [
      '{"principal":"alice","revision":2,"reads":3}',
    ]);
    now += 1_001;
    assert.deepEqual(await run('read_fixture'), [
      '{"principal":"alice","revision":2,"reads":4}',
    ]);
    assert.deepEqual(await run('write_fixture'), ['{"writes":1}']);
    assert.deepEqual(await run('write_fixture'), ['{"writes":2}']);
    assert.equal(reads, 4);
    assert.equal(writes, 2);
  } finally {
    Date.now = dateNow;
  }
}

async function substitutedResultValidation() {
  for (const mode of ['execute', 'skip', 'replace'] as const) {
    let checks = 0;
    let executions = 0;
    let outputChecks = 0;
    const outputSchema = z.object({ amount: z.number() }).transform((value) => {
      outputChecks++;
      return { amount: value.amount + 1 };
    });
    const tool = toolDefinition({
      name: 'calculate',
      description: 'Return an independently validated fixture result.',
      inputSchema: z.object({ amount: z.number() }),
      outputSchema,
    }).server(({ amount }) => {
      executions++;
      return { amount };
    });
    const middleware: ChatMiddleware = {
      onBeforeToolCall: () =>
        mode === 'skip'
          ? { type: 'skip', result: { amount: 'unvalidated' } }
          : { type: 'transformArgs', args: { amount: 3 } },
      onGuardToolCall: (_ctx, info) => {
        checks++;
        assert.deepEqual(info.args, { amount: 3 });
      },
      onAfterToolCall: () =>
        mode === 'replace'
          ? { type: 'replaceResult', result: { amount: 'unvalidated' } }
          : undefined,
    };
    const adapter = fakeText();
    adapter.setResponses([
      { toolCalls: [{ name: 'calculate', input: { amount: 'raw' } }] },
    ]);
    const results = toolResults(
      await drain(
        chat({
          adapter,
          threadId: mode,
          messages: [{ role: 'user', content: 'Calculate the fixture.' }],
          tools: [tool],
          middleware: [middleware],
          repairToolInput: false,
          agentLoopStrategy: maxIterations(1),
          debug: false,
        }),
      ),
    );
    assert.deepEqual(results, [
      mode === 'execute' ? '{"amount":4}' : '{"amount":"unvalidated"}',
    ]);
    assert.equal(checks, mode === 'skip' ? 0 : 1);
    assert.equal(executions, mode === 'skip' ? 0 : 1);
    assert.equal(outputChecks, mode === 'skip' ? 0 : 1);
    assert.equal(
      outputSchema.safeParse(JSON.parse(results[0] ?? 'null')).success,
      mode === 'execute',
    );
  }
}

function scriptedUsage(
  responses: FakeResponseStep[],
  snapshots:
    | (TokenUsage | undefined)[]
    | ((options: TextOptions) => TokenUsage | undefined),
) {
  const adapter = fakeText();
  adapter.setResponses(responses);
  const original = adapter.chatStream.bind(adapter);
  let index = 0;
  adapter.chatStream = async function* (options) {
    const usage =
      typeof snapshots === 'function' ? snapshots(options) : snapshots[index++];
    for await (const chunk of original(options)) {
      yield chunk.type === 'RUN_FINISHED' || chunk.type === 'RUN_ERROR'
        ? { ...chunk, usage }
        : chunk;
    }
  };
  return adapter;
}

async function multiTurnUsage() {
  const calls: LlmCall[] = [];
  const reported: (number | undefined)[] = [];
  const finished: (number | undefined)[] = [];
  const tool = toolDefinition({
    name: 'read_value',
    description: 'Read a fixture needed by the next model turn.',
  }).server(() => ({ value: 7 }));
  const inner = scriptedUsage(
    [
      { toolCalls: [{ name: 'read_value' }] },
      ({ request }) => {
        assert.equal(
          request.messages.find((message) => message.role === 'tool')?.content,
          '{"value":7}',
        );
        return { text: 'The value is seven.' };
      },
    ],
    [
      { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      { promptTokens: 4, completionTokens: 1, totalTokens: 5 },
    ],
  );
  const adapter = withUsage(inner, 'planner', (call) => calls.push(call));
  await drain(
    chat({
      adapter,
      threadId: 'usage',
      messages: [{ role: 'user', content: 'Read the value.' }],
      tools: [tool],
      agentLoopStrategy: maxIterations(2),
      middleware: [
        {
          onUsage: (_ctx, usage) => {
            reported.push(usage.totalTokens);
          },
          onFinish: (_ctx, info) => {
            finished.push(info.usage?.totalTokens);
          },
        },
      ],
      debug: false,
    }),
  );
  assert.equal(inner.state.callCount, 2);
  assert.deepEqual(
    calls.map((call) => call.role),
    ['planner', 'planner'],
  );
  assert.deepEqual(
    calls.map((call) => call.usage),
    [
      { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      { inputTokens: 4, outputTokens: 1, totalTokens: 5 },
    ],
  );
  assert.deepEqual(reported, [12, 5]);
  assert.deepEqual(finished, [5]);
  assert.equal(
    calls.reduce((total, call) => total + (call.usage?.totalTokens ?? 0), 0),
    17,
  );
}

async function finalizationUsage() {
  const calls: LlmCall[] = [];
  const reported: (number | undefined)[] = [];
  const finished: (number | undefined)[] = [];
  const tool = toolDefinition({
    name: 'read_value',
    description: 'Read a fixture before structured finalization.',
  }).server(() => ({ value: 7 }));
  const inner = scriptedUsage(
    [
      { toolCalls: [{ name: 'read_value' }] },
      { text: 'The value is seven.' },
      { text: '{"answer":"seven"}' },
    ],
    [
      { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      { promptTokens: 4, completionTokens: 1, totalTokens: 5 },
    ],
  );
  const original = inner.structuredOutput.bind(inner);
  inner.structuredOutput = async (options) => ({
    ...(await original(options)),
    usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
  });
  const chunks = await drain(
    chat({
      adapter: withUsage(inner, 'planner', (call) => calls.push(call)),
      threadId: 'finalization',
      messages: [{ role: 'user', content: 'Read the value.' }],
      tools: [tool],
      outputSchema: z.object({ answer: z.string() }),
      stream: true,
      agentLoopStrategy: maxIterations(2),
      middleware: [
        {
          onUsage: (_ctx, usage) => {
            reported.push(usage.totalTokens);
          },
          onFinish: (_ctx, info) => {
            finished.push(info.usage?.totalTokens);
          },
        },
      ],
      debug: false,
    }),
  );
  assert.equal(inner.state.callCount, 3);
  assert.deepEqual(
    calls.map((call) => call.usage?.totalTokens),
    [12, 5, 3],
  );
  assert.deepEqual(reported, [12, 5, 3]);
  assert.deepEqual(finished, [5]);
  assert.equal(
    calls.reduce((total, call) => total + (call.usage?.totalTokens ?? 0), 0),
    20,
  );
  assert.equal(
    chunks.filter(
      (chunk) =>
        chunk.type === 'CUSTOM' && chunk.name === 'structured-output.complete',
    ).length,
    1,
  );
}

async function failedTurnUsage() {
  const calls: LlmCall[] = [];
  let errors = 0;
  let finishes = 0;
  const inner = scriptedUsage(
    [
      { toolCalls: [{ name: 'read_value' }] },
      { error: 'Synthetic provider failure.' },
    ],
    [
      { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      { promptTokens: 6, completionTokens: 1, totalTokens: 7 },
    ],
  );
  const tool = toolDefinition({
    name: 'read_value',
    description: 'Read a fixture before a failed model turn.',
  }).server(() => ({ value: 7 }));
  const chunks = await drain(
    chat({
      adapter: withUsage(inner, 'planner', (call) => calls.push(call)),
      threadId: 'failed-usage',
      messages: [{ role: 'user', content: 'Read the value.' }],
      tools: [tool],
      agentLoopStrategy: maxIterations(2),
      middleware: [
        {
          onError: () => {
            errors++;
          },
          onFinish: () => {
            finishes++;
          },
        },
      ],
      debug: false,
    }),
  );
  assert.equal(inner.state.callCount, 2);
  assert.deepEqual(
    calls.map((call) => call.usage?.totalTokens),
    [12, 7],
  );
  assert.equal(
    calls.reduce((total, call) => total + (call.usage?.totalTokens ?? 0), 0),
    19,
  );
  assert.equal(errors, 1);
  assert.equal(finishes, 0);
  assert.equal(chunks.filter((chunk) => chunk.type === 'RUN_ERROR').length, 1);
}

async function concurrentUsagePresence() {
  const unknown: LlmCall[] = [];
  const zero: LlmCall[] = [];
  const inner = scriptedUsage(
    [{ text: 'First.' }, { text: 'Second.' }],
    (options) =>
      options.threadId === 'unknown'
        ? undefined
        : { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );
  const run = (threadId: string, adapter: ReturnType<typeof withUsage>) =>
    drain(
      chat({
        adapter,
        threadId,
        messages: [{ role: 'user', content: 'Reply once.' }],
        debug: false,
      }),
    );
  await Promise.all([
    run(
      'unknown',
      withUsage(inner, 'planner', (call) => unknown.push(call)),
    ),
    run(
      'zero',
      withUsage(inner, 'fallback', (call) => zero.push(call)),
    ),
  ]);
  assert.equal(inner.state.callCount, 2);
  assert.equal(unknown.length, 1);
  assert.equal(zero.length, 1);
  assert.equal(unknown[0]?.role, 'planner');
  assert.equal(unknown[0]?.usage, undefined);
  assert.equal(zero[0]?.role, 'fallback');
  assert.deepEqual(zero[0]?.usage, {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });
}

async function initialAdmission() {
  for (const budget of [0, 1]) {
    const adapter = fakeText();
    adapter.setResponses([{ toolCalls: [{ name: 'write_fixture' }] }]);
    let writes = 0;
    const aborts: (string | undefined)[] = [];
    const tool = toolDefinition({
      name: 'write_fixture',
      description: 'Count a side effect that admission must prevent.',
    }).server(() => ({ writes: ++writes }));
    await drain(
      chat({
        adapter,
        threadId: 'model-budget',
        messages: [{ role: 'user', content: 'Write the fixture.' }],
        tools: [tool],
        agentLoopStrategy: maxIterations(budget),
        middleware: [
          {
            onConfig: (ctx) => {
              if (ctx.phase === 'init' && budget <= 0)
                ctx.abort('No model budget.');
            },
            onAbort: (_ctx, info) => {
              aborts.push(info.reason);
            },
          },
        ],
        debug: false,
      }),
    );
    assert.equal(adapter.state.callCount, budget);
    assert.equal(writes, budget);
    assert.deepEqual(aborts, budget === 0 ? ['No model budget.'] : []);
  }
}

async function batchReservations() {
  let reserved = 0;
  let balance = 0;
  const effects: number[] = [];
  const tool = toolDefinition({
    name: 'increment',
    description: 'Apply an ordered fixture mutation.',
    inputSchema: z.object({ amount: z.number() }),
  }).server(async ({ amount }) => {
    const previous = balance;
    await Promise.resolve();
    balance = previous + amount;
    effects.push(balance);
    return { balance };
  });
  const adapter = fakeText();
  adapter.setResponses([
    {
      toolCalls: [
        { name: 'increment', input: { amount: 1 } },
        { name: 'increment', input: { amount: 2 } },
        { name: 'increment', input: { amount: 100 } },
      ],
    },
    { text: 'This turn must not run.' },
  ]);
  const chunks = await drain(
    chat({
      adapter,
      threadId: 'batch-budget',
      messages: [{ role: 'user', content: 'Apply the increments.' }],
      tools: [tool],
      toolExecution: 'sequential',
      agentLoopStrategy: maxIterations(3),
      middleware: [
        {
          onBeforeToolCall: () => {
            if (++reserved > 2)
              return {
                type: 'skip',
                result: { error: 'Tool budget exhausted.' },
              };
            return undefined;
          },
          onShouldContinue: () => false,
        },
      ],
      debug: false,
    }),
  );
  assert.equal(reserved, 3);
  assert.deepEqual(effects, [1, 3]);
  assert.equal(balance, 3);
  assert.equal(adapter.state.callCount, 1);
  assert.deepEqual(toolResults(chunks), [
    '{"balance":1}',
    '{"balance":3}',
    '{"error":"Tool budget exhausted."}',
  ]);
}

async function usageBeforeTools() {
  const cases = [
    {
      usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      writes: 0,
      aborts: ['Budget exhausted.'],
      results: [],
    },
    {
      usage: undefined,
      writes: 0,
      aborts: ['Usage unavailable.'],
      results: [],
    },
    {
      usage: { promptTokens: 4, completionTokens: 1, totalTokens: 5 },
      writes: 1,
      aborts: [],
      results: ['{"writes":1}'],
    },
  ];
  for (const expected of cases) {
    const calls: LlmCall[] = [];
    let writes = 0;
    const aborts: (string | undefined)[] = [];
    const inner = scriptedUsage(
      [{ toolCalls: [{ name: 'write_fixture' }] }],
      [expected.usage],
    );
    const tool = toolDefinition({
      name: 'write_fixture',
      description: 'Count a write blocked by the usage policy.',
    }).server(() => ({ writes: ++writes }));
    const chunks = await drain(
      chat({
        adapter: withUsage(inner, 'planner', (call) => calls.push(call)),
        threadId: 'usage-budget',
        messages: [{ role: 'user', content: 'Write the fixture.' }],
        tools: [tool],
        agentLoopStrategy: maxIterations(1),
        middleware: [
          {
            onGuardToolCall: () => {
              const usage = calls[0]?.usage;
              if (usage?.totalTokens === undefined)
                return { type: 'abort', reason: 'Usage unavailable.' };
              if (usage.totalTokens >= 10)
                return { type: 'abort', reason: 'Budget exhausted.' };
              return undefined;
            },
            onAbort: (_ctx, info) => {
              aborts.push(info.reason);
            },
          },
        ],
        debug: false,
      }),
    );
    assert.equal(inner.state.callCount, 1);
    assert.equal(calls.length, 1);
    assert.equal(writes, expected.writes);
    assert.deepEqual(toolResults(chunks), expected.results);
    assert.deepEqual(aborts, expected.aborts);
  }
}

async function nonCooperativeCancellation() {
  const controller = new AbortController();
  let notifyStarted = () => {};
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const effects: string[] = [];
  let signal: AbortSignal | undefined;
  let aborts = 0;
  let finishes = 0;
  const tool = toolDefinition({
    name: 'write_fixture',
    description: 'Model an external side effect that ignores cancellation.',
  }).server(async (_args, ctx) => {
    signal = ctx?.abortSignal;
    notifyStarted();
    await pending;
    effects.push('committed after cancellation');
    return { committed: true };
  });
  const adapter = fakeText();
  adapter.setResponses([
    { toolCalls: [{ name: 'write_fixture' }] },
    { text: 'This turn must not run.' },
  ]);
  const run = drain(
    chat({
      adapter,
      threadId: 'cancelled-write',
      messages: [{ role: 'user', content: 'Write the fixture.' }],
      tools: [tool],
      abortController: controller,
      agentLoopStrategy: maxIterations(2),
      middleware: [
        {
          onAbort: () => {
            aborts++;
          },
          onFinish: () => {
            finishes++;
          },
        },
      ],
      debug: false,
    }),
  );
  await started;
  controller.abort('Run retired.');
  release();
  await run;
  assert.equal(signal?.aborted, true);
  assert.deepEqual(effects, ['committed after cancellation']);
  assert.equal(adapter.state.callCount, 1);
  assert.equal(aborts, 1);
  assert.equal(finishes, 0);
}

async function retryUsage() {
  const calls: LlmCall[] = [];
  const reported: (number | undefined)[] = [];
  let iterations = 0;
  const inner = scriptedUsage(
    [{ error: 'Synthetic rate limit.' }, { text: 'Recovered.' }],
    [
      { promptTokens: 2, completionTokens: 0, totalTokens: 2 },
      { promptTokens: 4, completionTokens: 1, totalTokens: 5 },
    ],
  );
  const original = inner.chatStream.bind(inner);
  inner.chatStream = async function* (options) {
    for await (const chunk of original(options))
      yield chunk.type === 'RUN_ERROR' ? { ...chunk, retryAfterMs: 0 } : chunk;
  };
  const chunks = await drain(
    chat({
      adapter: withUsage(inner, 'planner', (call) => calls.push(call)),
      threadId: 'retry-usage',
      messages: [{ role: 'user', content: 'Reply once.' }],
      agentLoopStrategy: maxIterations(1),
      retry: { maxRetries: 1, maxWaitMs: 0 },
      middleware: [
        {
          onIteration: () => {
            iterations++;
          },
          onUsage: (_ctx, usage) => {
            reported.push(usage.totalTokens);
          },
        },
      ],
      debug: false,
    }),
  );
  assert.equal(inner.state.callCount, 2);
  assert.equal(iterations, 1);
  assert.deepEqual(
    calls.map((call) => call.usage?.totalTokens),
    [2, 5],
  );
  assert.deepEqual(reported, [5]);
  assert.equal(
    calls.reduce((total, call) => total + (call.usage?.totalTokens ?? 0), 0),
    7,
  );
  assert.equal(chunks.filter((chunk) => chunk.type === 'RUN_ERROR').length, 0);
}

async function deadlineBeforeTools() {
  for (const elapsed of [99, 100, 101]) {
    let now = 0;
    const clock = () => now;
    const deadline = 100;
    let writes = 0;
    const aborts: (string | undefined)[] = [];
    const adapter = fakeText();
    adapter.setResponses([
      () => {
        now = elapsed;
        return { toolCalls: [{ name: 'write_fixture' }] };
      },
    ]);
    const tool = toolDefinition({
      name: 'write_fixture',
      description: 'Count a write that must start before the deadline.',
    }).server(() => ({ writes: ++writes }));
    await drain(
      chat({
        adapter,
        threadId: 'deadline',
        messages: [{ role: 'user', content: 'Write the fixture.' }],
        tools: [tool],
        agentLoopStrategy: maxIterations(1),
        middleware: [
          {
            onGuardToolCall: () => {
              if (clock() >= deadline)
                return { type: 'abort', reason: 'Deadline reached.' };
              return undefined;
            },
            onAbort: (_ctx, info) => {
              aborts.push(info.reason);
            },
          },
        ],
        debug: false,
      }),
    );
    assert.equal(adapter.state.callCount, 1);
    assert.equal(writes, elapsed === 99 ? 1 : 0);
    assert.deepEqual(aborts, elapsed === 99 ? [] : ['Deadline reached.']);
  }
}

async function cumulativeTokenBudget() {
  const calls: LlmCall[] = [];
  let writes = 0;
  const aborts: (string | undefined)[] = [];
  const inner = scriptedUsage(
    [
      { toolCalls: [{ name: 'write_fixture' }] },
      { toolCalls: [{ name: 'write_fixture' }] },
      { text: 'This turn must not run.' },
    ],
    [
      { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
      { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    ],
  );
  const tool = toolDefinition({
    name: 'write_fixture',
    description: 'Count writes admitted by a cumulative token budget.',
  }).server(() => ({ writes: ++writes }));
  const chunks = await drain(
    chat({
      adapter: withUsage(inner, 'planner', (call) => calls.push(call)),
      threadId: 'cumulative-tokens',
      messages: [{ role: 'user', content: 'Apply the fixture writes.' }],
      tools: [tool],
      agentLoopStrategy: maxIterations(3),
      middleware: [
        {
          onGuardToolCall: () => {
            let tokens = 0;
            for (const call of calls) {
              if (call.usage?.totalTokens === undefined)
                return { type: 'abort', reason: 'Usage unavailable.' };
              tokens += call.usage.totalTokens;
            }
            if (tokens >= 10)
              return { type: 'abort', reason: 'Cumulative budget exhausted.' };
            return undefined;
          },
          onAbort: (_ctx, info) => {
            aborts.push(info.reason);
          },
        },
      ],
      debug: false,
    }),
  );
  assert.deepEqual(
    calls.map((call) => call.usage?.totalTokens),
    [6, 6],
  );
  assert.equal(inner.state.callCount, 2);
  assert.equal(writes, 1);
  assert.deepEqual(toolResults(chunks), ['{"writes":1}']);
  assert.deepEqual(aborts, ['Cumulative budget exhausted.']);
}

const scenarios = {
  'cache-authorization': cacheAuthorization,
  'cache-bypasses-guard': cacheBypassesGuard,
  'cache-scope-and-freshness': cacheScopeAndFreshness,
  'substituted-result-validation': substitutedResultValidation,
  'multi-turn-usage': multiTurnUsage,
  'finalization-usage': finalizationUsage,
  'failed-turn-usage': failedTurnUsage,
  'concurrent-usage-presence': concurrentUsagePresence,
  'initial-admission': initialAdmission,
  'batch-reservations': batchReservations,
  'usage-before-tools': usageBeforeTools,
  'non-cooperative-cancellation': nonCooperativeCancellation,
  'retry-usage': retryUsage,
  'deadline-before-tools': deadlineBeforeTools,
  'cumulative-token-budget': cumulativeTokenBudget,
};
const scenario = process.argv[2];
assert.ok(scenario && scenario in scenarios, `Unknown scenario: ${scenario}`);
await scenarios[scenario as keyof typeof scenarios]();
assert.equal(network, 0);
console.log(scenario);
