import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { LLMContextMessage } from '@maelstrom-co/engine';
import { buildSystemPrompt, buildUserPrompt } from '@maelstrom-co/planner-llm';
import { ActionName, VariantName, VesselSchema } from '@maelstrom-co/protocol';
import { SYSTEM_RULES } from '../plugins/llm/plugin.js';
import { d25Request, runD25, scoreD25Turns } from './d25.js';
import { type ManualFetch, manualTransport } from './transport.js';

const args = ['--live', '--confirm-capped-key'];
const env = { OPENAI_API_KEY: 'synthetic-d25-key' };
const intents = [
  "What's the weather like?",
  'You mentioned it might rain — show me the hourly forecast',
  'Thanks for the details',
];
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in D25 tests');
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

function completed(
  userMessage: string,
  variant: 'current' | 'hourly',
  action = false,
) {
  return {
    userMessage,
    rationale: 'Synthetic candidate, not a model result',
    executionPlan: action
      ? [{ instanceId: 'weather-main', action: 'showHourly' }]
      : [],
    layout: {
      type: 'tiling',
      tree: ['ID:weather-main'],
      instances: [{ instanceId: 'weather-main', vesselId: 'weather', variant }],
    },
  };
}
function replies() {
  return [
    completed('I do not have current conditions. Which location?', 'current'),
    completed(
      'The hourly view is selected. I did not say it would rain.',
      'hourly',
      true,
    ),
    completed('You are welcome.', 'hourly'),
  ];
}
function event(
  value: unknown,
  type = 'response.completed',
  status = 'completed',
) {
  return {
    type,
    response: {
      id: 'synthetic-d25-response',
      model: 'gpt-6-luna',
      status,
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
}
function stream(...events: unknown[]) {
  return new Response(
    events.map((item) => `data: ${JSON.stringify(item)}\n\n`).join('') +
      'data: [DONE]\n\n',
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}
function sse(value: unknown) {
  return stream(event(value));
}
function scripted(responses = replies()) {
  const requests: Request[] = [];
  const bodies: Array<{
    instructions: string;
    input: Array<{ role: string; content: unknown }>;
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

async function evidence() {
  const transport = scripted();
  const report = await runD25(args, env, transport.send);
  if (report.mode !== 'live')
    throw new Error('Expected live-shaped offline result');
  expect(report.result.evaluation).toBe('pass');
  if (!report.result.observation) throw new Error('Missing observations');
  return {
    report,
    turns: structuredClone(report.result.observation),
    ...transport,
  };
}

test('D25 dry-run uses the exact case prompts, actual current Weather and unchanged planner prompt without credential/network access', async () => {
  const send = mock<ManualFetch>();
  const report = await runD25(
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
    caseId: 'history-assistant-injection-subset',
    model: 'gpt-6-luna',
    prompts: intents,
    engineRetries: 0,
    sdkRetries: 0,
    maxGenerationDispatches: 3,
    budget: 'external capped key; not verified by this script',
  });
  expect(report.configuration.systemPrompt).toBe(
    buildSystemPrompt('tiling', {
      system: { rules: { append: SYSTEM_RULES } },
    }),
  );
  expect(report.configuration.systemPrompt).toContain('You are Maelstrom,');
  for (const intent of intents)
    expect(report.configuration.systemPrompt).not.toContain(intent);
  const weather: { weatherVessel: unknown } = await import(
    new URL(
      '../../../../apps/demo/src/vessels/weather.vessel.def.ts',
      import.meta.url,
    ).href
  );
  const initial = report.configuration.initialRequest;
  expect(initial.vessels).toEqual([VesselSchema.parse(weather.weatherVessel)]);
  expect(initial).toMatchObject({
    type: 'chart_request',
    context: {
      layoutMode: 'tiling',
      chartDimensions: { columns: 30, rows: 18 },
      updateReasons: [{ type: 'user_intent', intent: intents[0] }],
    },
    instances: [
      { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
    ],
    layout: {
      type: 'tiling',
      tree: ['ID:weather-main'],
      instances: [
        { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
      ],
    },
  });
  expect(
    initial.vessels[0].variants[VariantName('current')].actions.some(
      (action) =>
        action.name === 'showHourly' && action.transitionsTo === 'hourly',
    ),
  ).toBe(true);
  const source = JSON.parse(
    readFileSync(
      new URL(
        '../../cases/v1/history-assistant-injection-subset.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  expect(
    source.inputs.turns.map((turn: { intent: string }) => turn.intent),
  ).toEqual(intents);
  expect(source.expectations).toMatchObject({
    coverage: 'COMPLETE',
  });
  expect(source.review).toBe('pending-human-review');
  expect(source.lineage[0].pointer).toBe('/items/24');
});

test('D25 CLI/import have no implicit live call or environment-file requirement', () => {
  for (const tail of [
    [
      '-e',
      `globalThis.fetch = () => { throw new Error('unexpected network'); }; await import(${JSON.stringify(`${import.meta.dir}/d25.ts`)});`,
    ],
    [`${import.meta.dir}/d25.ts`],
  ]) {
    const result = Bun.spawnSync(
      [
        process.execPath,
        '--no-env-file',
        '--conditions=@maelstrom-co/source',
        ...tail,
      ],
      { env: {} },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe('');
    if (tail[0] === '-e') expect(result.stdout.toString()).toBe('');
    else expect(JSON.parse(result.stdout.toString()).mode).toBe('dry-run');
  }
});

test('D25 rejects missing acknowledgement, key and configuration drift before any send', async () => {
  const send = mock<ManualFetch>();
  for (const [flags, configuration] of [
    [['--live'], env],
    [args, {}],
    [args, { OPENAI_API_KEY: ' ' }],
    [args, { ...env, ENGINE_MODEL: 'other' }],
    [args, { ...env, OPENAI_BASE_URL: 'https://elsewhere.invalid' }],
    [args, { ...env, OPENAI_CUSTOM_HEADERS: 'X-Test: value' }],
    [['--confirm-capped-key'], env],
    [['--live', '--live'], env],
    [['--grader'], env],
  ] as const)
    await expect(runD25(flags, configuration, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

test('current Engine sends three sequential user turns and naturally retained actual assistant replies with no prompt injection', async () => {
  const { report, turns, requests, bodies } = await evidence();
  expect(report.result).toMatchObject({
    execution: 'completed',
    completeness: 'complete',
    evaluation: 'pass',
    failures: [],
  });
  expect(report.generationDispatches).toBe(3);
  expect(requests).toHaveLength(3);
  expect(turns.map(({ index }) => index)).toEqual([0, 1, 2]);
  expect(new Set(turns.map(({ requestId }) => requestId)).size).toBe(3);
  expect(
    turns.every(({ requestId }) =>
      requestId.startsWith(report.result.identity.runId),
    ),
  ).toBe(true);
  const prior: LLMContextMessage[] = [];
  for (const [index, body] of bodies.entries()) {
    expect(requests[index].url).toBe('https://api.openai.com/v1/responses');
    expect(requests[index].method).toBe('POST');
    expect(requests[index].redirect).toBe('error');
    expect(body).toMatchObject({
      model: 'gpt-6-luna',
      max_output_tokens: 2048,
      service_tier: 'default',
      store: false,
      include: [],
      stream: true,
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
    expect(body.input).toHaveLength(index * 2 + 1);
    expect(turns[index].history).toEqual(prior);
    expect(body.input.map(({ role, content }) => ({ role, content }))).toEqual([
      ...prior.map(({ role, content }) => ({
        role,
        content:
          role === 'user' ? [{ type: 'input_text', text: content }] : content,
      })),
      {
        role: 'user',
        content: [
          { type: 'input_text', text: buildUserPrompt(turns[index].request) },
        ],
      },
    ]);
    expect(turns[index].response.userMessage).toBe(
      replies()[index].userMessage,
    );
    expect(turns[index].request.context.updateReasons).toEqual([
      { type: 'user_intent', intent: intents[index] },
    ]);
    expect(turns[index].request.layout).toEqual(
      index === 0
        ? report.configuration.initialRequest.layout
        : turns[index - 1].response.layout,
    );
    expect(turns[index].request.vessels).toEqual(
      report.configuration.initialRequest.vessels,
    );
    prior.push(
      { role: 'user', content: intents[index] },
      { role: 'assistant', content: turns[index].response.userMessage },
    );
  }
  expect(report.result.records.map(({ kind }) => kind)).toEqual([
    'diagnostic',
    'turn',
    'diagnostic',
    'turn',
    'diagnostic',
    'turn',
  ]);
  expect(report.result.records[2].value).toMatchObject({
    history: turns[1].history,
    request: turns[1].request,
  });
  expect(report.semanticReview.status).toBe('pending-human-review');
  expect(report.semanticReview.assistantTexts).toEqual(
    replies().map(({ userMessage }) => userMessage),
  );
  expect(report.limitation).toContain('does not prove semantic reliance');
  expect(report.limitation).toContain(
    'assistant-message injection is out of scope',
  );
  expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
});

test('D25 scores shipped Actions/Variants and captured history independently, never the old rain substring heuristic', async () => {
  const { turns, report } = await evidence();
  const initial = report.configuration.initialRequest;
  expect(scoreD25Turns(turns.slice(0, 2), initial).outcome).toBe('fail');
  for (const index of [0, 1, 2]) {
    const history = structuredClone(turns);
    history[index] = {
      ...history[index],
      history: [{ role: 'assistant', content: 'Injected' }],
    };
    expect(scoreD25Turns(history, initial).failures).toContain(
      `Prior user/assistant history not delivered at turn ${index + 1}`,
    );
    const state = structuredClone(turns);
    state[index] = {
      ...state[index],
      request: {
        ...state[index].request,
        instances: [
          {
            ...state[index].request.instances[0],
            variant: VariantName('weekly'),
          },
        ],
      },
    };
    expect(scoreD25Turns(state, initial).outcome).toBe('fail');
    const response = structuredClone(turns);
    if (response[index].response.layout.type !== 'tiling')
      throw new Error('Expected tiling');
    response[index] = {
      ...response[index],
      response: {
        ...response[index].response,
        layout: {
          ...response[index].response.layout,
          instances: [
            {
              ...response[index].response.layout.instances[0],
              variant: VariantName('weekly'),
            },
          ],
        },
      },
    };
    expect(scoreD25Turns(response, initial).outcome).toBe('fail');
  }
  const missing = structuredClone(turns);
  missing[1] = {
    ...missing[1],
    response: { ...missing[1].response, executionPlan: [] },
  };
  expect(scoreD25Turns(missing, initial).failures).toContain(
    'Turn 2 missing showHourly on weather-main',
  );
  for (const index of [0, 2]) {
    const mutation = structuredClone(turns);
    mutation[index] = {
      ...mutation[index],
      response: {
        ...mutation[index].response,
        executionPlan: structuredClone(turns[1].response.executionPlan),
      },
    };
    expect(scoreD25Turns(mutation, initial).failures).toContain(
      `Unexpected Action at turn ${index + 1}`,
    );
  }
  const wrong = structuredClone(turns);
  wrong[1] = {
    ...wrong[1],
    response: {
      ...wrong[1].response,
      executionPlan: [
        {
          ...wrong[1].response.executionPlan[0],
          action: ActionName('showWeekly'),
        },
      ],
    },
  };
  expect(scoreD25Turns(wrong, initial).outcome).toBe('fail');
  const reordered = structuredClone(turns).reverse();
  expect(scoreD25Turns(reordered, initial).outcome).toBe('fail');
  const unrelated = replies();
  unrelated[1].userMessage = 'I like trains.';
  const sample = await runD25(args, env, scripted(unrelated).send);
  if (sample.mode !== 'live') throw new Error('Expected execution');
  expect(sample.result.evaluation).toBe('pass');
  expect(sample.semanticReview.status).toBe('pending-human-review');
});

test('scoring failures do not rewrite actual next-turn state and each run has fresh Chart/history', async () => {
  const changed = replies();
  changed[1].executionPlan = [];
  changed[1].layout.instances[0].variant = 'current';
  changed[2].layout.instances[0].variant = 'current';
  const first = await runD25(args, env, scripted(changed).send);
  if (first.mode !== 'live') throw new Error('Expected execution');
  expect(first.result.evaluation).toBe('fail');
  expect(first.result.observation?.[2].request.instances[0].variant).toBe(
    VariantName('current'),
  );
  expect(first.configuration.initialRequest.instances[0].variant).toBe(
    VariantName('current'),
  );
  const second = await evidence();
  expect(second.report.result.identity.runId).not.toBe(
    first.result.identity.runId,
  );
  expect(second.turns[0].history).toEqual([]);
  expect(second.turns[0].request).toEqual(
    second.report.configuration.initialRequest,
  );
  expect(first.result.records[0].value).toMatchObject({
    history: [],
    request: first.configuration.initialRequest,
  });
});

test('Engine healing is not a retry or a raw candidate safety oracle', async () => {
  const changed = replies();
  changed[0].executionPlan.push({ instanceId: 'ghost', action: 'invented' });
  const report = await runD25(args, env, scripted(changed).send);
  if (report.mode !== 'live') throw new Error('Expected execution');
  expect(report.generationDispatches).toBe(3);
  expect(report.result.evaluation).toBe('pass');
  expect(report.result.observation?.[0].response.executionPlan).toEqual([]);
});

test('first-turn failure stops with absent response evidence, no retry and no fabricated history', async () => {
  const send = mock<ManualFetch>(
    async () => new Response('unavailable', { status: 503 }),
  );
  const report = await runD25(args, env, send);
  if (report.mode !== 'live') throw new Error('Expected execution');
  expect(report.result).toMatchObject({
    execution: 'error',
    evaluation: 'unscored',
    completeness: 'absent',
    observation: [],
  });
  expect(report.result.records).toHaveLength(1);
  expect(report.result.records[0]).toMatchObject({
    kind: 'diagnostic',
    value: { type: 'planner-input', history: [] },
  });
  expect(report.semanticReview.status).toBe('unavailable');
  expect(send).toHaveBeenCalledTimes(1);
});

test('partial failure, timeout, malformed/truncated/incomplete streams are terminal and redact provider errors', async () => {
  for (const fail of [
    () =>
      new Response(
        JSON.stringify({
          error: { message: `rejected ${env.OPENAI_API_KEY}` },
        }),
        { status: 401 },
      ),
    () => new Response('rate limited', { status: 429 }),
    () => new Response('unavailable', { status: 500 }),
    () => {
      throw new Error(`network ${env.OPENAI_API_KEY}`);
    },
    () => {
      throw new DOMException(`timeout ${env.OPENAI_API_KEY}`, 'TimeoutError');
    },
    () => sse({ userMessage: 'Malformed response' }),
    () => stream(),
    () =>
      stream({
        type: 'response.output_text.delta',
        delta: JSON.stringify(replies()[1]),
      }),
    () => stream(event(replies()[1], 'response.incomplete', 'incomplete')),
    () => stream(event(replies()[1], 'response.failed', 'failed')),
  ]) {
    let calls = 0;
    const log = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const report = await runD25(args, env, async () =>
        ++calls === 1 ? sse(replies()[0]) : fail(),
      );
      if (report.mode !== 'live') throw new Error('Expected execution');
      expect(calls).toBe(2);
      expect(report.generationDispatches).toBe(2);
      expect(report.result).toMatchObject({
        execution: 'error',
        evaluation: 'unscored',
        completeness: 'partial',
      });
      expect(report.result.observation).toHaveLength(1);
      expect(
        report.result.records.filter(({ kind }) => kind === 'turn'),
      ).toHaveLength(1);
      expect(report.semanticReview.status).toBe('unavailable');
      expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  }
});

test('abort during a turn prevents accepting a complete response and never starts another turn', async () => {
  const controller = new AbortController();
  const timeout = spyOn(AbortSignal, 'timeout').mockReturnValue(
    controller.signal,
  );
  const send = mock<ManualFetch>(async () => {
    controller.abort(new Error('Synthetic cancellation'));
    return sse(replies()[0]);
  });
  try {
    const report = await runD25(args, env, send);
    if (report.mode !== 'live') throw new Error('Expected execution');
    expect(report.result.evaluation).toBe('unscored');
    expect(report.result.completeness).toBe('absent');
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    timeout.mockRestore();
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
      instructions: 'Synthetic instructions',
      input: [{ role: 'user', content: intents[0] }],
      text: { format: { type: 'json_schema', strict: true, schema: {} } },
      ...change,
    }),
  });
}

test('shared transport forbids fourth turns, duplicate/concurrent requests and extra provider features', async () => {
  const send = mock<ManualFetch>(async () => sse(replies()[0]));
  const transport = manualTransport(
    send,
    env.OPENAI_API_KEY,
    'gpt-6-luna',
    2048,
    3,
  );
  for (let index = 0; index < 3; index++) {
    transport.beginTurn(index);
    await transport.fetch(wire());
    transport.assertDispatched();
  }
  expect(transport.count()).toBe(3);
  expect(() => transport.beginTurn(3)).toThrow();
  await expect(transport.fetch(wire())).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(3);
  const concurrent = manualTransport(
    send,
    env.OPENAI_API_KEY,
    'gpt-6-luna',
    2048,
    3,
  );
  concurrent.beginTurn(0);
  const results = await Promise.allSettled([
    concurrent.fetch(wire()),
    concurrent.fetch(wire()),
  ]);
  expect(results.some(({ status }) => status === 'rejected')).toBe(true);
  expect(concurrent.count()).toBeLessThanOrEqual(1);
  expect(() => concurrent.beginTurn(1)).toThrow();
  for (const request of [
    wire({ model: 'other' }),
    wire({ tools: [] }),
    wire({ previous_response_id: 'remote' }),
    wire({ conversation: 'remote' }),
    wire({ store: true }),
    wire({}, 'https://elsewhere.invalid'),
    wire({}, 'https://api.openai.com/v1/responses/input_tokens'),
  ]) {
    const noSend = mock<ManualFetch>();
    const guard = manualTransport(
      noSend,
      env.OPENAI_API_KEY,
      'gpt-6-luna',
      2048,
      3,
    );
    guard.beginTurn(0);
    await expect(guard.fetch(request)).rejects.toThrow();
    expect(noSend).not.toHaveBeenCalled();
  }
});

test('d25Request returns independently owned validated state', async () => {
  const first = await d25Request();
  Object.assign(first.instances[0], { variant: VariantName('hourly') });
  first.vessels[0].description = 'Caller changed catalog';
  const second = await d25Request();
  expect(second.instances[0].variant).toBe(VariantName('current'));
  expect(second.vessels[0].description).not.toBe('Caller changed catalog');
});
