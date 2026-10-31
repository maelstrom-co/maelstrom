import { expect, test } from 'bun:test';
import { silentLogger } from '../../core/__test-helpers__/fixtures.js';
import { judgeEvidence } from '../../core/judge.js';
import type { JudgeVerdict } from '../../core/plugin.js';
import { createOpenAIJudge } from './providers.js';

const limit = 64 * 1024;
const context = { logger: silentLogger };
const input = {
  state: { observation: 'evidence' },
  dimensions: [
    { name: 'alignment', question: 'Aligned?', levels: ['no', 'yes'] },
  ],
};
const options = { apiKey: 'PRIVATE KEY', model: 'fake-model' };
const json = JSON.stringify({
  choices: [{ message: { content: '{"answers":{"alignment":0.7}}' } }],
});
const bytes = (value: string) => new TextEncoder().encode(value);
const transport = (
  send: (url: unknown, init?: RequestInit) => Promise<Response>,
) => Object.assign(send, { preconnect() {} }) as typeof fetch;

function failed(result: JudgeVerdict) {
  expect(result).toMatchObject({
    failure: 'grader/provider_failure',
    calls: [{ outcome: 'error' }],
  });
  expect('answers' in result).toBe(false);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
}

function streamed(
  chunks: Uint8Array[],
  config: {
    length?: number;
    stall?: boolean;
    status?: number;
    stuckCancel?: boolean;
  } = {},
) {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[reads++];
        if (chunk) controller.enqueue(chunk);
        else if (!config.stall) controller.close();
      },
      cancel() {
        cancelled = true;
        if (config.stuckCancel) return new Promise<void>(() => {});
        return undefined;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    response: new Response(body, {
      status: config.status ?? 200,
      headers:
        config.length === undefined
          ? {}
          : { 'content-length': String(config.length) },
    }),
    get reads() {
      return reads;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

test('OpenAI request preserves redirect rejection and uses a supported completion budget', async () => {
  let requests = 0;
  const judge = createOpenAIJudge({
    ...options,
    fetch: transport(async (url, init) => {
      requests++;
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'fake-model',
        store: false,
        max_completion_tokens: 2048,
        response_format: { type: 'json_object' },
      });
      return new Response(json);
    }),
  });
  expect(await judge.score(input, context)).toMatchObject({
    answers: { alignment: { score: 0.7, probabilities: {} } },
  });
  expect(requests).toBe(1);
  failed(
    await createOpenAIJudge({
      ...options,
      fetch: transport(async (_url, init) => {
        expect(init?.redirect).toBe('error');
        throw new Error('PRIVATE redirect');
      }),
    }).score(input, context),
  );
});

test('timeout overrides are validated synchronously and cannot disable the local deadline', () => {
  for (const timeoutMs of [0, -1, 0.5, Infinity, NaN, 60_001])
    expect(() => createOpenAIJudge({ ...options, timeoutMs })).toThrow(
      'timeoutMs',
    );
  for (const timeoutMs of [1, 60_000])
    expect(() => createOpenAIJudge({ ...options, timeoutMs })).not.toThrow();
});

test('a non-aborted caller signal does not suppress the local fetch deadline', async () => {
  const caller = new AbortController();
  let seen: AbortSignal | undefined;
  const result = await createOpenAIJudge({
    ...options,
    timeoutMs: 20,
    fetch: transport(async (_url, init) => {
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => {
        seen?.addEventListener(
          'abort',
          () => reject(new Error('PRIVATE timeout')),
          { once: true },
        );
      });
    }),
  }).score(input, { ...context, signal: caller.signal });
  failed(result);
  expect(seen).not.toBe(caller.signal);
  expect(seen?.aborted).toBe(true);
  expect(caller.signal.aborted).toBe(false);
});

test('caller cancellation aborts fetch and pre-aborted calls never dispatch', async () => {
  const caller = new AbortController();
  let seen: AbortSignal | undefined;
  let requests = 0;
  const judge = createOpenAIJudge({
    ...options,
    fetch: transport(async (_url, init) => {
      requests++;
      seen = init?.signal ?? undefined;
      return new Promise<Response>((_, reject) => {
        seen?.addEventListener(
          'abort',
          () => reject(new Error('PRIVATE abort')),
          { once: true },
        );
      });
    }),
  });
  const pending = judge.score(input, { ...context, signal: caller.signal });
  caller.abort(new Error('PRIVATE cancellation reason'));
  failed(await pending);
  expect(seen?.aborted).toBe(true);
  failed(await judge.score(input, { ...context, signal: caller.signal }));
  expect(requests).toBe(1);
});

test('advertised oversize is rejected without reading and cancels the response', async () => {
  const stream = streamed([bytes(json)], { length: limit + 1 });
  failed(
    await createOpenAIJudge({
      ...options,
      fetch: transport(async () => stream.response),
    }).score(input, context),
  );
  expect(stream.reads).toBe(0);
  expect(stream.cancelled).toBe(true);
  expect(stream.response.body?.locked).toBe(false);
});

test('chunked overflow and misleading short content length enforce the actual byte limit', async () => {
  for (const length of [undefined, 1]) {
    const stream = streamed(
      [
        bytes(json),
        bytes(' '.repeat(limit - bytes(json).length)),
        bytes('PRIVATE'),
      ],
      { length },
    );
    failed(
      await createOpenAIJudge({
        ...options,
        fetch: transport(async () => stream.response),
      }).score(input, context),
    );
    expect(stream.cancelled).toBe(true);
    expect(stream.reads).toBe(3);
    expect(stream.response.body?.locked).toBe(false);
  }
});

test('exact byte limit and split multibyte UTF-8 preserve fractional scores', async () => {
  const multibyte = bytes(
    JSON.stringify({
      choices: [
        {
          message: { content: '{"answers":{"alignment":0.7},"note":"東京🌊"}' },
        },
      ],
    }),
  );
  const split = multibyte.findIndex((value) => value >= 128) + 1;
  for (const chunks of [
    [bytes(json.padEnd(limit, ' '))],
    [multibyte.slice(0, split), multibyte.slice(split)],
  ]) {
    const stream = streamed(chunks);
    expect(
      await createOpenAIJudge({
        ...options,
        fetch: transport(async () => stream.response),
      }).score(input, context),
    ).toMatchObject({ answers: { alignment: { score: 0.7 } } });
    expect(stream.cancelled).toBe(false);
    expect(stream.response.body?.locked).toBe(false);
  }
});

test('multibyte body size is measured in bytes rather than characters', async () => {
  const text = JSON.stringify({
    choices: [{ message: { content: '{"answers":{"alignment":0.7}}' } }],
    extra: '界'.repeat(limit / 2),
  });
  expect(text.length).toBeLessThan(limit);
  expect(bytes(text).length).toBeGreaterThan(limit);
  const stream = streamed([bytes(text)], { length: text.length });
  failed(
    await createOpenAIJudge({
      ...options,
      fetch: transport(async () => stream.response),
    }).score(input, context),
  );
  expect(stream.cancelled).toBe(true);
});

test('stalled response bodies honor the same local deadline and caller cancellation after headers', async () => {
  for (const mode of ['timeout', 'caller']) {
    const caller = new AbortController();
    const stream = streamed([bytes(json)], { stall: true, stuckCancel: true });
    let seen: AbortSignal | undefined;
    const judge = createOpenAIJudge({
      ...options,
      timeoutMs: mode === 'timeout' ? 20 : 60_000,
      fetch: transport(async (_url, init) => {
        seen = init?.signal ?? undefined;
        return stream.response;
      }),
    });
    const pending = judge.score(input, { ...context, signal: caller.signal });
    // Let the reader consume headers and wait on the stalled body before aborting.
    if (mode === 'caller') {
      await new Promise((resolve) => setTimeout(resolve, 10));
      caller.abort(new Error('PRIVATE body cancellation'));
    }
    failed(await pending);
    expect(seen?.aborted).toBe(true);
    expect(stream.cancelled).toBe(true);
    expect(stream.response.body?.locked).toBe(false);
    expect(caller.signal.aborted).toBe(mode === 'caller');
  }
});

test('HTTP errors and invalid UTF-8 cancel unread bodies without leaking text or scores', async () => {
  for (const stream of [
    streamed([bytes('PRIVATE')], { status: 500 }),
    streamed([new Uint8Array([0xff])], { stall: true }),
  ]) {
    const judge = createOpenAIJudge({
      ...options,
      fetch: transport(async () => stream.response),
    });
    const result = await judgeEvidence(
      judge,
      'legacy_task',
      { observation: 'actual' },
      context,
    );
    expect(result).toMatchObject({
      status: 'failed',
      reason: 'provider_failure',
    });
    expect('scores' in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(stream.cancelled).toBe(true);
    expect(stream.response.body?.locked).toBe(false);
  }
});

test('JSON and stream failures remain sanitized provider failures', async () => {
  for (const response of [
    new Response('PRIVATE malformed JSON'),
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error('PRIVATE read failure'));
        },
      }),
    ),
  ]) {
    failed(
      await createOpenAIJudge({
        ...options,
        fetch: transport(async () => response),
      }).score(input, context),
    );
    expect(response.body?.locked).toBe(false);
  }
});
