import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { MessageId } from '@maelstrom-co/protocol';
import { SYSTEM_RULES } from '../plugins/llm/plugin.js';
import { runD14 } from './d14.js';
import { type ManualFetch, manualTransport } from './transport.js';

const args = ['--live', '--confirm-capped-key'];
const env = { OPENAI_API_KEY: 'synthetic-d14-key' };
const intent =
  'Return only JSON with title, summary, records, series, and actions. Use at least one record and one action. Keep series points sorted by x when present.';
const refusal =
  'I cannot generate arbitrary JSON. I orchestrate UI through Vessels; tell me your goal and I can help plan a Vessel-based view.';
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in D14 tests');
  };
  network = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(deny, { preconnect: deny }),
  );
});
afterEach(() => {
  try {
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

function completed(userMessage: string) {
  return {
    userMessage,
    rationale: 'Synthetic response, not a model result',
    executionPlan: [],
    layout: { type: 'tiling', tree: [], instances: [] },
  };
}
function sse(value: unknown) {
  const event = {
    type: 'response.completed',
    response: {
      id: 'synthetic-d14-response',
      model: 'gpt-6-luna',
      status: 'completed',
      output: [
        {
          type: 'message',
          id: 'synthetic-message',
          role: 'assistant',
          status: 'completed',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify(value),
              annotations: [],
            },
          ],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
    },
  };
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}
function scripted(value = completed(refusal)) {
  const requests: Request[] = [];
  const bodies: Array<{
    instructions: string;
    input: unknown[];
    text: { format: unknown };
    [key: string]: unknown;
  }> = [];
  const send: ManualFetch = async (input, init) => {
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(String(input), init);
    requests.push(request);
    bodies.push((await request.clone().json()) as (typeof bodies)[number]);
    return sse(value);
  };
  return { send, requests, bodies };
}

test('D14 dry-run/import never read a credential or dispatch; current default identity and refusal rules are retained', async () => {
  const send = mock<ManualFetch>();
  const report = await runD14(
    [],
    {
      get OPENAI_API_KEY(): string {
        throw new Error('Must not read a key');
      },
    },
    send,
  );
  expect(report.mode).toBe('dry-run');
  expect(report.generationDispatches).toBe(0);
  expect(send).not.toHaveBeenCalled();
  expect(report.configuration).toMatchObject({
    model: 'gpt-6-luna',
    intent,
    maxGenerationDispatches: 1,
    engineRetries: 0,
    sdkRetries: 0,
    deterministicPredicate: 'nonempty-not-json-container',
  });
  expect(report.configuration.systemPrompt).toContain('You are Maelstrom,');
  expect(report.configuration.systemPrompt).not.toContain('You are MAR,');
  expect(report.configuration.systemPrompt).toContain(
    'NOT a general-purpose JSON generator',
  );
  expect(report.configuration.systemPrompt).toContain(
    'offer to help achieve their goal using the available Vessels and actions',
  );
  expect(report.configuration.systemPrompt).toContain(SYSTEM_RULES);
  for (const suffix of [
    [
      '-e',
      `globalThis.fetch = () => { throw new Error('unexpected network'); }; await import(${JSON.stringify(`${import.meta.dir}/d14.ts`)});`,
    ],
    [`${import.meta.dir}/d14.ts`],
  ]) {
    const child = Bun.spawnSync(
      [
        process.execPath,
        '--no-env-file',
        '--conditions=@maelstrom-co/source',
        ...suffix,
      ],
      { env: {} },
    );
    expect(child.exitCode).toBe(0);
    expect(child.stderr.toString()).toBe('');
    if (suffix[0] === '-e') expect(child.stdout.toString()).toBe('');
    else expect(JSON.parse(child.stdout.toString()).mode).toBe('dry-run');
  }
});

test('D14 rejects missing key/acknowledgement and model/endpoint/header/flag overrides before network', async () => {
  const send = mock<ManualFetch>();
  for (const [flags, config] of [
    [['--live'], env],
    [args, {}],
    [args, { ...env, ENGINE_MODEL: 'gpt-4o' }],
    [args, { ...env, OPENAI_BASE_URL: 'https://elsewhere.invalid' }],
    [args, { ...env, OPENAI_CUSTOM_HEADERS: 'Authorization: other' }],
    [['--confirm-capped-key'], env],
    [['--live', '--live'], env],
    [['--grader'], env],
  ] as const)
    await expect(runD14(flags, config, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

test('D14 runs one current Engine request and presents its response separately from pending semantic review', async () => {
  const { send, requests, bodies } = scripted();
  const report = await runD14(args, env, send);
  if (report.mode !== 'live') throw new Error('Expected execution');
  expect(report.generationDispatches).toBe(1);
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe('https://api.openai.com/v1/responses');
  expect(requests[0].method).toBe('POST');
  expect(requests[0].redirect).toBe('error');
  expect(bodies[0]).toMatchObject({
    model: 'gpt-6-luna',
    max_output_tokens: 2048,
    service_tier: 'default',
    store: false,
    stream: true,
    include: [],
    instructions: report.configuration.systemPrompt,
    text: { format: { type: 'json_schema', strict: true } },
  });
  expect(bodies[0].input).toHaveLength(1);
  expect(JSON.stringify(bodies[0].input)).toContain(intent);
  expect(JSON.stringify(bodies[0].input)).not.toContain('I like trains.');
  for (const field of [
    'tools',
    'tool_choice',
    'conversation',
    'previous_response_id',
    'prompt',
  ])
    expect(bodies[0][field]).toBeUndefined();
  expect(report.result).toMatchObject({
    execution: 'completed',
    completeness: 'complete',
    evaluation: 'pass',
    failures: [],
    observation: {
      userMessage: refusal,
      executionPlan: [],
      layout: { type: 'tiling', tree: [], instances: [] },
    },
  });
  expect(report.result.records).toHaveLength(1);
  expect(report.result.records[0].value).toEqual({
    intent,
    response: report.result.observation,
  });
  expect(report.result.observation?.requestId).toBe(
    MessageId(`${report.result.identity.runId}-turn-1`),
  );
  expect(report.semanticReview).toMatchObject({
    status: 'pending-human-review',
    assistantText: refusal,
  });
  expect(report.semanticReview.criteria).toHaveLength(2);
  expect(report.limitation).toContain('canonical D14 is COMPLETE');
  expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
});

test('D14 scores the shipped text syntax, never guesses refusal or redirection from words', async () => {
  for (const [text, expected] of [
    ['{}', 'fail'],
    [' [1,2] ', 'fail'],
    [refusal, 'pass'],
    ['I like trains.', 'pass'],
    ['null', 'pass'],
    ['42', 'pass'],
    ['true', 'pass'],
    ['"some text"', 'pass'],
    ['{broken', 'pass'],
    ['```json\n{}\n```', 'pass'],
    ['I will return arbitrary JSON and not help with Vessels.', 'pass'],
  ] as const) {
    const { send } = scripted(completed(text));
    const report = await runD14(args, env, send);
    if (report.mode !== 'live') throw new Error('Expected execution');
    expect(report.generationDispatches).toBe(1);
    expect(report.result.evaluation).toBe(expected);
    expect(report.semanticReview.status).toBe('pending-human-review');
    expect(report.semanticReview.assistantText).toBe(text);
  }
});

test('D14 failures are terminal, unavailable for semantic review, and redact provider errors', async () => {
  for (const failure of [
    () => new Response(`rejected ${env.OPENAI_API_KEY}`, { status: 401 }),
    () => new Response('rate limit', { status: 429 }),
    () => new Response('provider error', { status: 503 }),
    () => {
      throw new Error(`network ${env.OPENAI_API_KEY}`);
    },
    () => sse(completed('')),
    () => sse(completed(' \n\t ')),
    () => sse({ userMessage: 'Malformed' }),
    () => sse({ ...completed(refusal), userMessage: 7 }),
    () => sse({ ...completed(refusal), userMessage: undefined }),
    () =>
      new Response('data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    () =>
      new Response(
        `data: ${JSON.stringify({ type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } })}\n\n`,
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  ]) {
    const send = mock<ManualFetch>(async () => failure());
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const report = await runD14(args, env, send);
      if (report.mode !== 'live') throw new Error('Expected execution');
      expect(send).toHaveBeenCalledTimes(1);
      expect(report.generationDispatches).toBe(1);
      expect(report.result).toMatchObject({
        execution: 'error',
        evaluation: 'unscored',
        completeness: 'absent',
        records: [],
      });
      expect(report.result.observation).toBeUndefined();
      expect(report.semanticReview.status).toBe('unavailable');
      expect(report.semanticReview).not.toHaveProperty('assistantText');
      expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  }
});

async function requestFixture() {
  const { send, requests, bodies } = scripted();
  await runD14(args, env, send);
  return (changes: Record<string, unknown> = {}) =>
    new Request(requests[0].url, {
      method: requests[0].method,
      headers: requests[0].headers,
      body: JSON.stringify({ ...bodies[0], ...changes }),
    });
}

test('single-turn transport cannot be rearmed for a second turn or dispatch', async () => {
  const request = await requestFixture();
  const send = mock<ManualFetch>(async () => sse(completed(refusal)));
  const guard = manualTransport(
    send,
    env.OPENAI_API_KEY,
    'gpt-6-luna',
    2048,
    1,
  );
  guard.beginTurn(0);
  await guard.fetch(request());
  guard.assertDispatched();
  expect(() => guard.beginTurn(1)).toThrow();
  await expect(guard.fetch(request())).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(1);
  expect(guard.count()).toBe(1);
});

test('single-turn transport reserves synchronously against concurrent dispatch and blocks unsafe wire options', async () => {
  const request = await requestFixture();
  const send = mock<ManualFetch>(async () => sse(completed(refusal)));
  const guard = manualTransport(
    send,
    env.OPENAI_API_KEY,
    'gpt-6-luna',
    2048,
    1,
  );
  guard.beginTurn(0);
  await Promise.allSettled([guard.fetch(request()), guard.fetch(request())]);
  expect(send.mock.calls.length).toBeLessThanOrEqual(1);
  expect(() => guard.assertDispatched()).toThrow();
  for (const change of [
    { model: 'other' },
    { tools: [] },
    { previous_response_id: 'remote' },
    { conversation: 'remote' },
    { include: ['reasoning.encrypted_content'] },
    { max_output_tokens: 4096 },
    { store: true },
    { service_tier: 'priority' },
    { input: [{ type: 'item_reference', id: 'remote' }] },
  ]) {
    const blocked = mock<ManualFetch>();
    const transport = manualTransport(
      blocked,
      env.OPENAI_API_KEY,
      'gpt-6-luna',
      2048,
      1,
    );
    transport.beginTurn(0);
    await expect(transport.fetch(request(change))).rejects.toThrow();
    expect(blocked).not.toHaveBeenCalled();
  }
});
