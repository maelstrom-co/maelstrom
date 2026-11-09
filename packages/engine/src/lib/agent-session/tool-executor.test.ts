import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { defer } from '../__test-helpers__/defer.js';
import { summarizeAsTruncatedJson } from './__test-helpers__/summarize-as-truncated-json.js';
import type { ToolCallIdentity } from './server-tool-runner.js';
import {
  serverTool,
  ToolError,
  type ServerTool,
  type ServerToolContext,
} from './server-tool.js';
import {
  executeToolCall,
  toModelToolPayload,
  validateToolResultEnvelope,
} from './tool-executor.js';
import { createToolRegistry, type ToolRegistryEntry } from './tool-registry.js';

const orderInput = z.object({ orderId: z.string() });
const orderOutput = z.object({ orderId: z.string(), total: z.number() });

const identity: ToolCallIdentity = { user: { id: 'user-7' }, token: 'tok-9' };

describe('identity', () => {
  test('reaches the tool only through ctx and never through the parsed input', async () => {
    const seen: { input: unknown; ctx: ServerToolContext }[] = [];
    const entry = entryFor({
      execute: async (input, ctx) => {
        seen.push({ input, ctx });
        return { orderId: input.orderId, total: 12 };
      },
    });
    const signal = new AbortController().signal;

    const result = await executeToolCall(
      entry,
      { orderId: 'o-1', user: 'forged', token: 'forged' },
      identity,
      signal,
    );

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.input).toEqual({ orderId: 'o-1' });
    expect(seen[0]?.ctx.user).toBe(identity.user);
    expect(seen[0]?.ctx.token).toBe('tok-9');
    expect(seen[0]?.ctx.signal).toBe(signal);
  });

  test('ctx carries no token when the identity has none', async () => {
    let seenCtx: ServerToolContext | undefined;
    const entry = entryFor({
      execute: async (input, ctx) => {
        seenCtx = ctx;
        return { orderId: input.orderId, total: 1 };
      },
    });

    await executeToolCall(
      entry,
      { orderId: 'o-1' },
      { user: 'anon' },
      new AbortController().signal,
    );

    expect(seenCtx?.user).toBe('anon');
    expect(seenCtx && 'token' in seenCtx).toBe(false);
  });
});

test('invalid arguments return invalid_arguments without running the tool', async () => {
  let runs = 0;
  const entry = entryFor({
    execute: async () => {
      runs += 1;
      return { orderId: 'o-1', total: 1 };
    },
  });

  const result = await executeToolCall(
    entry,
    { orderId: 42 },
    identity,
    new AbortController().signal,
  );

  expect(result).toEqual({
    ok: false,
    code: 'invalid_arguments',
    summary: expect.any(String),
    cause: expect.any(z.ZodError),
  });
  expect(runs).toBe(0);
});

test('output failing the output schema returns invalid_output', async () => {
  const entry = entryFor({
    execute: async () => ({ orderId: 'o-1', total: 'twelve' }) as never,
  });

  const result = await executeToolCall(
    entry,
    { orderId: 'o-1' },
    identity,
    new AbortController().signal,
  );

  expect(result).toEqual({
    ok: false,
    code: 'invalid_output',
    summary: expect.any(String),
    cause: expect.any(z.ZodError),
  });
});

describe('schemas that throw or need async parsing', () => {
  const schemaFailures = [
    ['a throwing refine', throwingRefine],
    ['an async refine', asyncRefine],
  ] as const;

  test.each(schemaFailures)(
    'an input schema with %s returns invalid_arguments without running the tool',
    async (_label, withFailure) => {
      let runs = 0;
      const entry = entryFor({
        input: withFailure(orderInput),
        execute: async () => {
          runs += 1;
          return { orderId: 'o-1', total: 1 };
        },
      });

      const result = await executeToolCall(
        entry,
        { orderId: 'o-1' },
        identity,
        new AbortController().signal,
      );

      expect(result).toEqual({
        ok: false,
        code: 'invalid_arguments',
        summary: 'latest_order received invalid arguments',
        cause: expect.any(Error),
      });
      expect(runs).toBe(0);
    },
  );

  test.each(schemaFailures)(
    'an output schema with %s returns invalid_output after the tool ran',
    async (_label, withFailure) => {
      let runs = 0;
      const entry = entryFor({
        output: withFailure(orderOutput),
        execute: async () => {
          runs += 1;
          return { orderId: 'o-1', total: 1 };
        },
      });

      const result = await executeToolCall(
        entry,
        { orderId: 'o-1' },
        identity,
        new AbortController().signal,
      );

      expect(result).toEqual({
        ok: false,
        code: 'invalid_output',
        summary: 'latest_order returned an invalid result',
        cause: expect.any(Error),
      });
      expect(runs).toBe(1);
    },
  );

  test.each(schemaFailures)(
    'an envelope checked against an output schema with %s is rejected',
    (_label, withFailure) => {
      const entry = entryFor({ output: withFailure(orderOutput) });

      expect(
        validateToolResultEnvelope(entry, {
          ok: true,
          value: { orderId: 'o-1', total: 3 },
          summary: 'Order o-1',
        }),
      ).toEqual({
        valid: false,
        reason: 'value does not match the latest_order output schema',
      });
    },
  );
});

describe('failures', () => {
  test('a ToolError message passes through to the summary and the model payload', async () => {
    const entry = entryFor({
      execute: async () => {
        throw new ToolError('Order history is unavailable');
      },
    });

    const result = await executeToolCall(
      entry,
      { orderId: 'o-1' },
      identity,
      new AbortController().signal,
    );

    expect(result).toEqual({
      ok: false,
      code: 'tool_failed',
      summary: 'Order history is unavailable',
      cause: expect.any(ToolError),
    });
    expect(toModelToolPayload(result)).toEqual({
      ok: false,
      error: 'Order history is unavailable',
    });
  });

  test('a plain throw is replaced by "<tool> failed" and its message reaches only cause', async () => {
    const sentinel = 'SENTINEL-db-password-5f3a';
    const thrown = new Error(`connection refused for ${sentinel}`);
    const entry = entryFor({
      execute: async () => {
        throw thrown;
      },
    });

    const result = await executeToolCall(
      entry,
      { orderId: 'o-1' },
      identity,
      new AbortController().signal,
    );

    expect(result).toEqual({
      ok: false,
      code: 'tool_failed',
      summary: 'latest_order failed',
      cause: thrown,
    });
    expect(result.ok ? undefined : result.cause).toBe(thrown);
    const payload = toModelToolPayload(result);
    expect(payload).toEqual({ ok: false, error: 'latest_order failed' });
    expect(Object.keys(payload as object)).not.toContain('cause');
    expect(JSON.stringify(payload)).not.toContain(sentinel);
  });

  test('a thrown non-Error value is sanitized too', async () => {
    const entry = entryFor({
      execute: async () => {
        throw 'raw string with SENTINEL';
      },
    });

    const result = await executeToolCall(
      entry,
      { orderId: 'o-1' },
      identity,
      new AbortController().signal,
    );

    expect(result).toEqual({
      ok: false,
      code: 'tool_failed',
      summary: 'latest_order failed',
      cause: 'raw string with SENTINEL',
    });
    expect(JSON.stringify(toModelToolPayload(result))).not.toContain(
      'SENTINEL',
    );
  });
});

describe('cancellation', () => {
  test('an already aborted signal returns cancelled without running the tool', async () => {
    let runs = 0;
    const entry = entryFor({
      execute: async () => {
        runs += 1;
        return { orderId: 'o-1', total: 1 };
      },
    });
    const controller = new AbortController();
    controller.abort();

    const result = await executeToolCall(
      entry,
      { orderId: 'o-1' },
      identity,
      controller.signal,
    );

    expect(result).toEqual({
      ok: false,
      code: 'cancelled',
      summary: expect.any(String),
    });
    expect(runs).toBe(0);
  });

  test('the tool sees the caller signal as ctx.signal and observes its abort', async () => {
    const started = defer<AbortSignal>();
    const aborted = defer<void>();
    const entry = entryFor({
      execute: async (input, ctx) => {
        started.resolve(ctx.signal);
        await new Promise<void>((resolve) =>
          ctx.signal.addEventListener('abort', () => resolve(), {
            once: true,
          }),
        );
        aborted.resolve();
        return { orderId: input.orderId, total: 0 };
      },
    });
    const controller = new AbortController();

    const pending = executeToolCall(
      entry,
      { orderId: 'o-1' },
      identity,
      controller.signal,
    );
    const toolSignal = await started.promise;
    expect(toolSignal).toBe(controller.signal);
    expect(toolSignal.aborted).toBe(false);

    controller.abort();
    await aborted.promise;
    expect(toolSignal.aborted).toBe(true);
    await pending;
  });
});

describe('validateToolResultEnvelope', () => {
  const entry = entryFor({});

  test('rejects a success envelope whose value fails the output schema', () => {
    expect(
      validateToolResultEnvelope(entry, {
        ok: true,
        value: { orderId: 'o-1', total: 'twelve' },
        summary: 'Order o-1',
      }),
    ).toEqual({ valid: false, reason: expect.any(String) });
  });

  test('rejects a value that is not an envelope', () => {
    expect(validateToolResultEnvelope(entry, 'cached!')).toEqual({
      valid: false,
      reason: expect.any(String),
    });
    expect(
      validateToolResultEnvelope(entry, {
        ok: false,
        code: 'made_up',
        summary: 'x',
      }),
    ).toEqual({ valid: false, reason: expect.any(String) });
  });

  test('accepts a well-formed failure envelope', () => {
    expect(
      validateToolResultEnvelope(entry, {
        ok: false,
        code: 'tool_failed',
        summary: 'Order history is unavailable',
      }),
    ).toEqual({
      valid: true,
      result: {
        ok: false,
        code: 'tool_failed',
        summary: 'Order history is unavailable',
      },
    });
  });

  test('accepts a well-formed success envelope with the parsed value', () => {
    expect(
      validateToolResultEnvelope(entry, {
        ok: true,
        value: { orderId: 'o-1', total: 3, extra: true },
        summary: 'Order o-1',
      }),
    ).toEqual({
      valid: true,
      result: {
        ok: true,
        value: { orderId: 'o-1', total: 3 },
        summary: 'Order o-1',
      },
    });
  });
});

describe('summaries', () => {
  test('a 300-character summary is cut to 200 characters with an ellipsis', async () => {
    const entry = entryFor({ summarize: () => 'x'.repeat(300) });

    const result = await executeToolCall(
      entry,
      { orderId: 'o-1' },
      identity,
      new AbortController().signal,
    );

    expect(result.summary).toHaveLength(200);
    expect(result.summary.endsWith('…')).toBe(true);
    expect(result.summary.startsWith('x'.repeat(199))).toBe(true);
  });

  test('the cap never splits a surrogate pair', async () => {
    const entry = entryFor({
      summarize: () => `${'x'.repeat(198)}\u{1F600}${'y'.repeat(50)}`,
    });

    const result = await executeToolCall(
      entry,
      { orderId: 'o-1' },
      identity,
      new AbortController().signal,
    );

    expect(result.summary).toBe(`${'x'.repeat(198)}…`);
  });

  test('a long ToolError message is capped the same way', async () => {
    const entry = entryFor({
      execute: async () => {
        throw new ToolError('y'.repeat(300));
      },
    });

    const result = await executeToolCall(
      entry,
      { orderId: 'o-1' },
      identity,
      new AbortController().signal,
    );

    expect(result.summary).toHaveLength(200);
    expect(result.summary.endsWith('…')).toBe(true);
  });

  test('a throwing summarize leaves the result ok with "<tool> succeeded"', async () => {
    const entry = entryFor({
      summarize: () => {
        throw new Error('summarize blew up with SENTINEL');
      },
    });

    const result = await executeToolCall(
      entry,
      { orderId: 'o-1' },
      identity,
      new AbortController().signal,
    );

    expect(result).toEqual({
      ok: true,
      value: { orderId: 'o-1', total: 12 },
      summary: 'latest_order succeeded',
    });
  });

  test('an empty summary falls back to "<tool> succeeded"', async () => {
    const entry = entryFor({ summarize: () => '' });

    const result = await executeToolCall(
      entry,
      { orderId: 'o-1' },
      identity,
      new AbortController().signal,
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toBe('latest_order succeeded');
  });

  test('summarize receives the validated output', async () => {
    const received: unknown[] = [];
    const entry = entryFor({
      execute: async (input) =>
        ({ orderId: input.orderId, total: 12, internal: 'drop me' }) as never,
      summarize: (output) => {
        received.push(output);
        return `Order ${output.orderId} totals ${output.total}`;
      },
    });

    const result = await executeToolCall(
      entry,
      { orderId: 'o-1' },
      identity,
      new AbortController().signal,
    );

    expect(received).toEqual([{ orderId: 'o-1', total: 12 }]);
    expect(result).toEqual({
      ok: true,
      value: { orderId: 'o-1', total: 12 },
      summary: 'Order o-1 totals 12',
    });
    expect(toModelToolPayload(result)).toEqual({ orderId: 'o-1', total: 12 });
  });
});

test('the truncated JSON test summarizer caps its output at 200 characters', () => {
  expect(summarizeAsTruncatedJson({ a: 1 })).toBe('{"a":1}');
  const long = summarizeAsTruncatedJson({ text: 'z'.repeat(300) });
  expect(long).toHaveLength(200);
  expect(long.endsWith('…')).toBe(true);
});

type OrderTool = ServerTool<
  z.infer<typeof orderInput>,
  z.infer<typeof orderOutput>
>;

function entryFor(
  overrides: Partial<
    Pick<OrderTool, 'input' | 'output' | 'execute' | 'summarize'>
  >,
): ToolRegistryEntry {
  const tool = serverTool({
    name: 'latest_order',
    description: 'Returns the latest order',
    input: orderInput,
    output: orderOutput,
    execute: async (input) => ({ orderId: input.orderId, total: 12 }),
    summarize: summarizeAsTruncatedJson,
    ...overrides,
  });
  const entry = createToolRegistry([tool]).get(tool.name);
  if (!entry) throw new Error('test tool did not register');
  return entry;
}

function throwingRefine<T>(schema: z.ZodType<T>): z.ZodType<T> {
  return schema.refine(() => {
    throw new Error('refine blew up');
  });
}

function asyncRefine<T>(schema: z.ZodType<T>): z.ZodType<T> {
  return schema.refine(async () => true);
}
