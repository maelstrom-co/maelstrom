import { expect, test } from 'bun:test';
import { join } from 'node:path';

async function probe(
  source: string,
  scenario: string,
  provider: 'openai' | 'gemini',
) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--conditions=@maelstrom-co/source',
      '-e',
      `
      import assert from 'node:assert/strict';
      import { chat } from '@tanstack/ai';
      const scenario = ${JSON.stringify(scenario)};
      ${source}
      assert.equal(unexpectedNetwork, 0);
      console.log(scenario);
    `,
    ],
    {
      // Gemini is declared by the demo workspace; use its public entry without adding a dependency.
      cwd:
        provider === 'gemini'
          ? join(import.meta.dir, '..', '..', '..', '..', 'apps', 'demo')
          : join(import.meta.dir, '..', '..'),
      stdout: 'pipe',
      stderr: 'pipe',
      signal: AbortSignal.timeout(10_000),
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, stderr).toBe(0);
  expect(stderr).toBe('');
  expect(stdout.trim()).toBe(scenario);
}

const openai = String.raw`
  import { createOpenaiChat } from '@tanstack/ai-openai';
  let unexpectedNetwork = 0;
  const requests = [];
  let cached;
  let failNext = false;
  function forbidNetwork() {
    unexpectedNetwork++;
    throw new Error('Unexpected network request in prompt-cache audit.');
  }
  globalThis.fetch = Object.assign(async () => forbidNetwork(), { preconnect: forbidNetwork });
  const fetch = Object.assign(async (input, init) => {
    const request = new Request(input, init);
    if (!['https://api.openai.com/v1/responses', 'https://gateway-audit.invalid/v1/responses'].includes(request.url))
      return forbidNetwork();
    requests.push(await request.json());
    if (failNext) {
      failNext = false;
      return Response.json({ error: { message: 'Synthetic rate limit.' } }, {
        status: 429, headers: { 'retry-after-ms': '1' },
      });
    }
    const response = {
      id: 'response-audit', model: 'gpt-6-luna', status: 'completed', output: [],
      usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11,
        ...(cached === undefined ? {} : { input_tokens_details: { cached_tokens: cached } }),
      },
    };
    return new Response('data: ' + JSON.stringify({ type: 'response.completed', response }) + '\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  }, { preconnect: forbidNetwork });
  async function run(options = {}, config = {}) {
    let usage;
    const adapter = createOpenaiChat('gpt-6-luna', 'offline-placeholder', {
      baseURL: 'https://api.openai.com/v1', fetch, maxRetries: 0, ...config,
    });
    const chunks = [];
    for await (const chunk of chat({
      adapter, threadId: 'stable-session',
      systemPrompts: ['Stable instructions.'],
      messages: [{ role: 'user', content: 'Unchanged fixture.' }],
      middleware: [{ onUsage: (_ctx, value) => { usage = value; } }],
      debug: false, ...options,
    })) chunks.push(chunk);
    assert.equal(chunks.some(chunk => chunk.type === 'RUN_ERROR'), false, JSON.stringify(chunks));
    assert.equal(chunks.filter(chunk => chunk.type === 'RUN_FINISHED').length, 1);
    return { body: requests.at(-1), usage };
  }
  if (scenario === 'openai-options') {
    const first = await run();
    const second = await run();
    assert.equal(first.body.prompt_cache_key, 'stable-session');
    assert.deepEqual(second.body, first.body);
    assert.equal(Object.hasOwn(first.body, 'prompt_cache_options'), false);
    const long = await run({ promptCache: { retention: 'long', key: 'explicit-session' } });
    assert.equal(long.body.prompt_cache_key, 'explicit-session');
    assert.deepEqual(long.body.prompt_cache_options, { ttl: '30m' });
    const none = await run({ promptCache: 'none' });
    assert.equal(Object.hasOwn(none.body, 'prompt_cache_key'), false);
    assert.deepEqual(none.body.prompt_cache_options, { mode: 'explicit' });
    const override = await run({
      promptCache: 'long',
      modelOptions: { prompt_cache_key: 'native-key', prompt_cache_options: { mode: 'explicit' } },
    });
    assert.equal(override.body.prompt_cache_key, 'native-key');
    assert.deepEqual(override.body.prompt_cache_options, { mode: 'explicit' });
    const gateway = await run({}, { baseURL: 'https://gateway-audit.invalid/v1' });
    assert.equal(Object.hasOwn(gateway.body, 'prompt_cache_key'), false);
    failNext = true;
    const before = requests.length;
    await run({}, { maxRetries: 1 });
    assert.equal(requests.length - before, 2);
    assert.deepEqual(requests.at(-2), requests.at(-1));
  } else {
    assert.equal(scenario, 'openai-usage');
    cached = undefined;
    const missing = (await run()).usage;
    cached = 0;
    const zero = (await run()).usage;
    cached = 4;
    const positive = (await run()).usage;
    assert.equal(missing.promptTokensDetails?.cachedTokens, undefined);
    assert.equal(zero.promptTokensDetails?.cachedTokens, undefined);
    assert.deepEqual(zero, missing);
    assert.equal(positive.promptTokensDetails?.cachedTokens, 4);
  }
`;

const gemini = String.raw`
  import { createGeminiChat } from '@tanstack/ai-gemini';
  let unexpectedNetwork = 0;
  const requests = [];
  let cached;
  function forbidNetwork() {
    unexpectedNetwork++;
    throw new Error('Unexpected network request in prompt-cache audit.');
  }
  globalThis.fetch = Object.assign(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== 'https://gemini-audit.invalid' || !url.pathname.endsWith('/models/gemini-2.5-flash:streamGenerateContent'))
      return forbidNetwork();
    requests.push(await request.json());
    const response = {
      candidates: [{ content: { role: 'model', parts: [{ text: 'Done.' }] }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1, totalTokenCount: 11,
        ...(cached === undefined ? {} : { cachedContentTokenCount: cached }),
      },
    };
    return new Response('data: ' + JSON.stringify(response) + '\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  }, { preconnect: forbidNetwork });
  async function run(options = {}) {
    let usage;
    const adapter = createGeminiChat('gemini-2.5-flash', 'offline-placeholder', {
      baseURL: 'https://gemini-audit.invalid', httpOptions: { retryOptions: { attempts: 1 } },
    });
    const chunks = [];
    for await (const chunk of chat({
      adapter, threadId: 'stable-session',
      systemPrompts: ['Stable instructions.'],
      messages: [{ role: 'user', content: 'Unchanged fixture.' }],
      middleware: [{ onUsage: (_ctx, value) => { usage = value; } }],
      debug: false, ...options,
    })) chunks.push(chunk);
    assert.equal(chunks.some(chunk => chunk.type === 'RUN_ERROR'), false, JSON.stringify(chunks));
    assert.equal(chunks.filter(chunk => chunk.type === 'RUN_FINISHED').length, 1);
    return { body: requests.at(-1), usage };
  }
  if (scenario === 'gemini-options') {
    const first = await run();
    const second = await run({ promptCache: { retention: 'long', key: 'explicit-session' } });
    assert.deepEqual(second.body, first.body);
    assert.equal(Object.hasOwn(first.body, 'cachedContent'), false);
    assert.equal(JSON.stringify(first.body).includes('stable-session'), false);
    const explicit = await run({
      promptCache: 'none', modelOptions: { cachedContent: 'cachedContents/existing-fixture' },
    });
    assert.equal(explicit.body.cachedContent, 'cachedContents/existing-fixture');
    assert.deepEqual(explicit.body.contents, first.body.contents);
    assert.deepEqual(explicit.body.systemInstruction, first.body.systemInstruction);
  } else {
    assert.equal(scenario, 'gemini-usage');
    cached = undefined;
    const missing = (await run()).usage;
    cached = 0;
    const zero = (await run()).usage;
    cached = 4;
    const positive = (await run()).usage;
    assert.equal(missing.promptTokensDetails?.cachedTokens, undefined);
    assert.equal(zero.promptTokensDetails?.cachedTokens, undefined);
    assert.deepEqual(zero, missing);
    assert.equal(positive.promptTokensDetails?.cachedTokens, 4);
  }
`;

test('OpenAI preserves thread cache keys and retry prefixes while explicit native options take precedence', async () => {
  await probe(openai, 'openai-options', 'openai');
});

test('OpenAI drops reported zero cache tokens, so absent normalized usage cannot establish a cache miss', async () => {
  await probe(openai, 'openai-usage', 'openai');
});

test('Gemini ignores common prompt-cache hints and requires a provider-owned cache reference', async () => {
  await probe(gemini, 'gemini-options', 'gemini');
});

test('Gemini drops reported zero cache tokens, so absent normalized usage cannot establish a cache miss', async () => {
  await probe(gemini, 'gemini-usage', 'gemini');
});
