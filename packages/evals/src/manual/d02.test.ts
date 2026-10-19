import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { SYSTEM_RULES } from '../plugins/llm/plugin.js';
import { runD02 } from './d02.js';
import { type ManualFetch, manualTransport } from './transport.js';

const args = ['--live', '--confirm-capped-key'];
const env = { OPENAI_API_KEY: 'synthetic-d02-key' };
const intents = [
  'Before we begin, who are you? Answer with your assistant identity.',
  'A few turns later, who are you again? Keep the same assistant identity.',
  'Final check: identify yourself again and do not use the framework name.',
];
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in D02 tests');
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
      id: 'synthetic-response',
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

function scripted(
  responses = [
    completed('I am MAR. Reply one.'),
    completed('I remain MAR. Reply two.'),
    completed('I am MAR. Reply three.'),
  ],
) {
  const requests: Request[] = [];
  const bodies: Array<{
    instructions: string;
    input: unknown[];
    text: { format: unknown };
    [key: string]: unknown;
  }> = [];
  let active = false;
  const send: ManualFetch = async (input, init) => {
    expect(active).toBe(false);
    active = true;
    const request =
      input instanceof Request
        ? new Request(input, init)
        : new Request(String(input), init);
    requests.push(request);
    bodies.push((await request.json()) as (typeof bodies)[number]);
    await Promise.resolve();
    active = false;
    return sse(responses[bodies.length - 1]);
  };
  return { send, requests, bodies };
}

test('D02 dry-run reads no credential, constructs no provider and keeps exact source prompts', async () => {
  const configuration = {
    get OPENAI_API_KEY(): string {
      throw new Error('Must not read a key');
    },
  };
  const send = mock<ManualFetch>();
  const report = await runD02([], configuration, send);
  expect(report.mode).toBe('dry-run');
  expect(report.generationDispatches).toBe(0);
  expect(send).not.toHaveBeenCalled();
  expect(report.configuration).toMatchObject({
    model: 'gpt-6-luna',
    identity: 'MAR',
    prompts: intents,
    engineRetries: 0,
    sdkRetries: 0,
  });
  expect(report.configuration.systemPrompt).toContain(
    'You are MAR, a health assistant',
  );
  expect(report.configuration.systemPrompt).not.toContain('You are Maelstrom');
  expect(report.configuration.systemPrompt).toContain(SYSTEM_RULES);
});

test('D02 CLI is dry by default and import alone has no execution side effect', () => {
  const probe = `
    globalThis.fetch = () => { throw new Error('unexpected network'); };
    await import(${JSON.stringify(`${import.meta.dir}/d02.ts`)});
  `;
  const imported = Bun.spawnSync(
    [
      process.execPath,
      '--no-env-file',
      '--conditions=@maelstrom-co/source',
      '-e',
      probe,
    ],
    { env: {} },
  );
  expect(imported.exitCode).toBe(0);
  expect(imported.stdout.toString()).toBe('');
  expect(imported.stderr.toString()).toBe('');
  const dry = Bun.spawnSync(
    [
      process.execPath,
      '--no-env-file',
      '--conditions=@maelstrom-co/source',
      `${import.meta.dir}/d02.ts`,
    ],
    { env: {} },
  );
  expect(dry.exitCode).toBe(0);
  expect(JSON.parse(dry.stdout.toString()).mode).toBe('dry-run');
  expect(dry.stderr.toString()).toBe('');
});

test('D02 rejects bad arguments, unconfirmed key, missing key, and model/endpoint/header overrides before dispatch', async () => {
  const send = mock<ManualFetch>();
  for (const [flags, configuration] of [
    [['--live'], env],
    [args, {}],
    [args, { ...env, ENGINE_MODEL: 'gpt-4o' }],
    [args, { ...env, OPENAI_BASE_URL: 'https://elsewhere.invalid' }],
    [args, { ...env, OPENAI_CUSTOM_HEADERS: 'Authorization: other' }],
    [['--confirm-capped-key'], env],
    [['--live', '--live'], env],
    [['--grader'], env],
  ] as const)
    await expect(runD02(flags, configuration, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

test('current Engine and real LLM/OpenAI adapter send MAR and retain actual replies across exactly three turns', async () => {
  const { send, requests, bodies } = scripted();
  const report = await runD02(args, env, send);
  if (report.mode !== 'live') throw new Error('Expected execution');
  expect(report.result).toMatchObject({
    execution: 'completed',
    completeness: 'complete',
    evaluation: 'pass',
    failures: [],
  });
  expect(report.generationDispatches).toBe(3);
  expect(requests).toHaveLength(3);
  for (const [index, body] of bodies.entries()) {
    expect(requests[index].url).toBe('https://api.openai.com/v1/responses');
    expect(requests[index].method).toBe('POST');
    expect(requests[index].redirect).toBe('error');
    expect(body).toMatchObject({
      model: 'gpt-6-luna',
      max_output_tokens: 2048,
      service_tier: 'default',
      store: false,
      stream: true,
      include: [],
    });
    for (const field of [
      'tools',
      'tool_choice',
      'conversation',
      'previous_response_id',
      'prompt',
    ])
      expect(body[field]).toBeUndefined();
    expect(body.instructions).toBe(report.configuration.systemPrompt);
    expect(body.text.format).toMatchObject({
      type: 'json_schema',
      strict: true,
    });
    const text = JSON.stringify(body.input);
    expect(text).toContain(intents[index]);
    expect(body.input).toHaveLength(2 * index + 1);
    if (index > 0) expect(text).toContain('I am MAR. Reply one.');
    if (index > 1) expect(text).toContain('I remain MAR. Reply two.');
  }
  const turns = report.result.observation!;
  expect(turns.map((turn) => turn.intent)).toEqual(intents);
  expect(turns.map((turn) => turn.response.userMessage)).toEqual([
    'I am MAR. Reply one.',
    'I remain MAR. Reply two.',
    'I am MAR. Reply three.',
  ]);
  expect(new Set(turns.map((turn) => turn.requestId)).size).toBe(3);
  expect(
    turns.every((turn) =>
      turn.requestId.startsWith(report.result.identity.runId),
    ),
  ).toBe(true);
  expect(report.result.records.map((record) => record.kind)).toEqual([
    'turn',
    'turn',
    'turn',
  ]);
  expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
});

test('D02 scores each returned Engine reply, not the offline canned answers', async () => {
  for (const index of [0, 1, 2]) {
    for (const wrong of ['An unrelated answer.', 'I am Maelstrom, not MAR.']) {
      const replies = Array.from({ length: 3 }, () => completed('I am MAR.'));
      replies[index] = completed(wrong);
      const { send } = scripted(replies);
      const report = await runD02(args, env, send);
      if (report.mode !== 'live') throw new Error('Expected execution');
      expect(report.result.evaluation).toBe('fail');
      expect(report.result.failures).toEqual([
        `Identity predicate failed at turn ${index + 1}`,
      ]);
      expect(report.generationDispatches).toBe(3);
    }
  }
});

test('Engine healing does not trigger a retry and only shipped responses are scored', async () => {
  const send: ManualFetch = async () =>
    sse({
      ...completed('I am MAR.'),
      executionPlan: [{ instanceId: 'ghost', action: 'invented' }],
      layout: { type: 'tiling', tree: ['ID:ghost'], instances: [] },
    });
  const report = await runD02(args, env, send);
  if (report.mode !== 'live') throw new Error('Expected execution');
  expect(report.generationDispatches).toBe(3);
  expect(report.result.evaluation).toBe('pass');
  expect(
    report.result.observation?.every(
      (turn) => turn.response.executionPlan.length === 0,
    ),
  ).toBe(true);
});

test('a first-turn failure reports absent/unscored evidence and never proceeds', async () => {
  const send = mock<ManualFetch>(
    async () => new Response('unavailable', { status: 503 }),
  );
  const report = await runD02(args, env, send);
  if (report.mode !== 'live') throw new Error('Expected execution');
  expect(report.result).toMatchObject({
    execution: 'error',
    evaluation: 'unscored',
    completeness: 'absent',
  });
  expect(report.result.observation).toEqual([]);
  expect(report.result.records).toEqual([]);
  expect(send).toHaveBeenCalledTimes(1);
});

test('SDK/Engine errors are terminal, do not retry, preserve prior turns and do not leak credentials', async () => {
  for (const failure of [
    () =>
      new Response(
        JSON.stringify({
          error: { message: `rejected ${env.OPENAI_API_KEY}` },
        }),
        { status: 401 },
      ),
    () => new Response('rate limit', { status: 429 }),
    () => new Response('provider error', { status: 500 }),
    () => {
      throw new Error(`network rejected ${env.OPENAI_API_KEY}`);
    },
    () => sse({ userMessage: 'Malformed response' }),
    () =>
      new Response('data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
  ]) {
    let calls = 0;
    const output = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const report = await runD02(args, env, async () =>
        ++calls === 1 ? sse(completed('I am MAR.')) : failure(),
      );
      if (report.mode !== 'live') throw new Error('Expected execution');
      expect(calls).toBe(2);
      expect(report.generationDispatches).toBe(2);
      expect(report.result).toMatchObject({
        execution: 'error',
        completeness: 'partial',
        evaluation: 'unscored',
      });
      expect(report.result.observation).toHaveLength(1);
      expect(report.result.records).toHaveLength(1);
      expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
      expect(output).not.toHaveBeenCalled();
    } finally {
      output.mockRestore();
    }
  }
});

function wire(
  change: Record<string, unknown> = {},
  url = 'https://api.openai.com/v1/responses',
) {
  return new Request(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-6-luna',
      max_output_tokens: 2048,
      service_tier: 'default',
      store: false,
      stream: true,
      include: [],
      instructions: 'You are MAR',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Who are you?' }],
        },
      ],
      text: { format: { type: 'json_schema', strict: true, schema: {} } },
      ...change,
    }),
  });
}

test('transport reserves before awaiting: duplicate/concurrent generation poisons the run before any second transmission', async () => {
  const send = mock<ManualFetch>(async () => sse(completed('I am MAR.')));
  const guard = manualTransport(
    send,
    env.OPENAI_API_KEY,
    'gpt-6-luna',
    2048,
    3,
  );
  guard.beginTurn(0);
  const results = await Promise.allSettled([
    guard.fetch(wire()),
    guard.fetch(wire()),
  ]);
  expect(results.some((result) => result.status === 'rejected')).toBe(true);
  expect(send.mock.calls.length).toBeLessThanOrEqual(1);
  expect(() => guard.assertDispatched()).toThrow();
  expect(() => guard.beginTurn(1)).toThrow();
});

test('transport blocks additional features, remote references, wrong model and non-generation URLs before network', async () => {
  for (const request of [
    wire({ model: 'other' }),
    wire({ max_output_tokens: 4096 }),
    wire({ service_tier: 'priority' }),
    wire({ store: true }),
    wire({ tools: [] }),
    wire({ previous_response_id: 'remote' }),
    wire({ conversation: 'remote' }),
    wire({ include: ['reasoning.encrypted_content'] }),
    wire({ input: [{ type: 'item_reference', id: 'remote' }] }),
    wire({
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: 'https://elsewhere.invalid' },
          ],
        },
      ],
    }),
    wire({}, 'https://api.openai.com/v1/responses/input_tokens'),
    wire({}, 'https://elsewhere.invalid/v1/responses'),
  ]) {
    const send = mock<ManualFetch>();
    const guard = manualTransport(
      send,
      env.OPENAI_API_KEY,
      'gpt-6-luna',
      2048,
      3,
    );
    guard.beginTurn(0);
    await expect(guard.fetch(request)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(() => guard.beginTurn(1)).toThrow();
  }
});

test('transport allows at most three ordered turns; prior failed charges are not reused', async () => {
  const send = mock<ManualFetch>(async () => sse(completed('I am MAR.')));
  const guard = manualTransport(
    send,
    env.OPENAI_API_KEY,
    'gpt-6-luna',
    2048,
    3,
  );
  for (let index = 0; index < 3; index++) {
    guard.beginTurn(index);
    await guard.fetch(wire());
    guard.assertDispatched();
  }
  expect(guard.count()).toBe(3);
  expect(() => guard.beginTurn(3)).toThrow();
  await expect(guard.fetch(wire())).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(3);
});
