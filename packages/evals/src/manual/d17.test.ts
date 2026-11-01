import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { buildSystemPrompt, buildUserPrompt } from '@maelstrom-co/planner-llm';
import {
  ChartRequestSchema,
  type MaelstromResponse,
  MessageId,
  TilingResponseSchema,
  VariantName,
  VesselSchema,
} from '@maelstrom-co/protocol';
import { SYSTEM_RULES } from '../plugins/llm/plugin.js';
import { d17Request, runD17, scoreD17Response } from './d17.js';
import { type ManualFetch, manualTransport } from './transport.js';

const args = ['--live', '--confirm-capped-key'];
const env = { OPENAI_API_KEY: 'synthetic-d17-key' };
const intent = 'Switch to the weekly view';
const clarification = 'Which weekly view do you mean: Weather or Calendar?';
const instances = [
  { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
  { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
];
const tree = ['V', 'ID:weather-main', 'ID:calendar-main'];
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in D17 tests');
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

function completed(userMessage = clarification) {
  return {
    userMessage,
    rationale: 'Synthetic response, not a model result',
    executionPlan: [],
    layout: {
      type: 'tiling',
      tree: [...tree],
      instances: structuredClone(instances),
    },
  };
}
function sse(value: unknown) {
  const event = {
    type: 'response.completed',
    response: {
      id: 'synthetic-d17-response',
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
function scripted(value: unknown = completed()) {
  const requests: Request[] = [];
  const bodies: Array<{
    instructions: string;
    input: unknown[];
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

test('D17 request uses both complete current demo catalogs and an explicit 30x18 two-Instance tiling Chart', async () => {
  const initial = await d17Request();
  const weather = await import(
    new URL(
      '../../../../apps/demo/src/vessels/weather.vessel.def.ts',
      import.meta.url,
    ).href
  );
  const calendar = await import(
    new URL(
      '../../../../apps/demo/src/vessels/calendar.vessel.def.ts',
      import.meta.url,
    ).href
  );
  expect(initial).toEqual(
    ChartRequestSchema.parse({
      type: 'chart_request',
      vessels: [
        VesselSchema.parse(weather.weatherVessel),
        VesselSchema.parse(calendar.calendarVessel),
      ],
      instances,
      layout: { type: 'tiling', tree, instances },
      context: {
        layoutMode: 'tiling',
        chartDimensions: { columns: 30, rows: 18 },
        updateReasons: [{ type: 'user_intent', intent }],
      },
    }),
  );
  const [weatherCatalog, calendarCatalog] = initial.vessels;
  expect(
    weatherCatalog.variants[VariantName('current')].actions,
  ).toContainEqual(
    expect.objectContaining({ name: 'showWeekly', transitionsTo: 'weekly' }),
  );
  expect(calendarCatalog.variants[VariantName('month')].actions).toContainEqual(
    expect.objectContaining({ name: 'showWeek', transitionsTo: 'week' }),
  );
  expect(Object.keys(weatherCatalog.variants)).toEqual([
    'current',
    'hourly',
    'weekly',
  ]);
  expect(Object.keys(calendarCatalog.variants)).toEqual([
    'month',
    'week',
    'day',
  ]);
  const other = await d17Request();
  expect(other).toEqual(initial);
  expect(other).not.toBe(initial);
});

test('D17 dry-run and import do not read keys or dispatch; system prompt is exactly the existing eval prompt', async () => {
  const send = mock<ManualFetch>();
  const report = await runD17(
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
  });
  expect(report.configuration.systemPrompt).toBe(
    buildSystemPrompt('tiling', {
      system: { rules: { append: SYSTEM_RULES } },
    }),
  );
  expect(report.configuration.systemPrompt).toContain('You are Maelstrom,');
  expect(report.configuration.systemPrompt).not.toContain(clarification);
  for (const suffix of [
    [
      '-e',
      `globalThis.fetch = () => { throw new Error('unexpected network'); }; await import(${JSON.stringify(`${import.meta.dir}/d17.ts`)});`,
    ],
    [`${import.meta.dir}/d17.ts`],
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

test('D17 bad flags, missing acknowledgement/key and model/endpoint/header overrides stop before transmission', async () => {
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
    await expect(runD17(flags, config, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

test('D17 sends one real Engine/planner request with both choices and no oracle hints, and scores the returned response', async () => {
  const { send, requests, bodies } = scripted();
  const report = await runD17(args, env, send);
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
  expect(bodies[0].input).toEqual([
    {
      type: 'message',
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: buildUserPrompt(report.configuration.initialRequest),
        },
      ],
    },
  ]);
  const text = JSON.stringify(bodies[0].input);
  for (const term of [
    intent,
    'weather-main',
    'calendar-main',
    'showWeekly',
    'showWeek',
    'current',
    'month',
    'setLocation',
    'addEvent',
  ])
    expect(text).toContain(term);
  expect(text).not.toContain(clarification);
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
  });
  const response = report.result.observation;
  expect(response?.userMessage).toBe(clarification);
  expect(response?.layout).toEqual(report.configuration.initialRequest.layout);
  expect(response?.executionPlan).toEqual([]);
  expect(response?.requestId).toBe(
    MessageId(`${report.result.identity.runId}-turn-1`),
  );
  expect(report.result.records).toHaveLength(1);
  expect(report.result.records[0].value).toEqual({
    request: report.configuration.initialRequest,
    response,
  });
  expect(report.semanticReview).toMatchObject({
    status: 'pending-human-review',
    assistantText: clarification,
  });
  expect(report.limitation).toContain('canonical D17 is COMPLETE');
  expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
});

test('D17 clarification lexical signal rejects absent/one-target/incidental questions but never certifies semantics', async () => {
  for (const [text, passes] of [
    [clarification, true],
    ['Would you like the WEATHER or CALENDAR weekly view?', true],
    ['Should I switch the Weather view or the Calendar view?', true],
    ['Which one?', false],
    ['Which Weather view?', false],
    ['Weather or Calendar.', false],
    ['Weather and Calendar are here. Anything else?', false],
    ['The weatherproof and calendaring views; which one?', false],
    [
      'I already changed both. Which Weather or Calendar view did you mean?',
      true,
    ],
  ] as const) {
    const { send } = scripted(completed(text));
    const report = await runD17(args, env, send);
    if (report.mode !== 'live') throw new Error('Expected execution');
    expect(report.result.evaluation).toBe(passes ? 'pass' : 'fail');
    expect(report.result.failures).toEqual(
      passes
        ? []
        : [
            'Clarification signal missing: ask Weather or Calendar in one question',
          ],
    );
    expect(report.semanticReview.status).toBe('pending-human-review');
    expect(report.generationDispatches).toBe(1);
  }
});

test('D17 fails valid single-target mutations, both-target mutations, retained-state changes and geometry changes despite clarification prose', async () => {
  for (const changes of [
    {
      executionPlan: [{ instanceId: 'weather-main', action: 'showWeekly' }],
      layout: {
        ...completed().layout,
        instances: [{ ...instances[0], variant: 'weekly' }, instances[1]],
      },
    },
    {
      executionPlan: [{ instanceId: 'calendar-main', action: 'showWeek' }],
      layout: {
        ...completed().layout,
        instances: [instances[0], { ...instances[1], variant: 'week' }],
      },
    },
    {
      executionPlan: [
        { instanceId: 'weather-main', action: 'showWeekly' },
        { instanceId: 'calendar-main', action: 'showWeek' },
      ],
      layout: {
        ...completed().layout,
        instances: [
          { ...instances[0], variant: 'weekly' },
          { ...instances[1], variant: 'week' },
        ],
      },
    },
    {
      executionPlan: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          paramsJson: '{"location":"Paris"}',
        },
      ],
    },
    {
      layout: {
        ...completed().layout,
        tree: ['H', 'ID:weather-main', 'ID:calendar-main'],
      },
    },
    {
      layout: {
        ...completed().layout,
        tree: ['V:2,1', 'ID:weather-main', 'ID:calendar-main'],
      },
    },
    {
      layout: {
        ...completed().layout,
        tree: ['V', 'ID:calendar-main', 'ID:weather-main'],
      },
    },
    { layout: { ...completed().layout, tree: ['ID:weather-main'] } },
    {
      layout: {
        type: 'tiling',
        tree: ['ID:weather-main'],
        instances: [instances[0]],
      },
    },
    {
      layout: {
        type: 'tiling',
        tree: [...tree],
        instances: [
          ...instances,
          {
            instanceId: 'weather-other',
            vesselId: 'weather',
            variant: 'current',
          },
        ],
      },
    },
    {
      layout: {
        ...completed().layout,
        instances: [{ ...instances[0], variant: 'weekly' }, instances[1]],
      },
    },
  ]) {
    const { send } = scripted({ ...completed(), ...changes });
    const report = await runD17(args, env, send);
    if (report.mode !== 'live') throw new Error('Expected execution');
    expect(report.generationDispatches).toBe(1);
    expect(report.result.execution).toBe('completed');
    expect(report.result.evaluation).toBe('fail');
    expect(report.result.failures.length).toBeGreaterThan(0);
    expect(
      report.result.failures.every(
        (f) => !f.startsWith('Clarification signal'),
      ),
    ).toBe(true);
    expect(report.result.records[0].value).toMatchObject({
      request: { instances, layout: { type: 'tiling', tree, instances } },
    });
  }
});

test('D17 exact state comparator covers complete snapshot identity, order and layout type; missing evidence cannot pass', async () => {
  const initial = await d17Request();
  const candidate = TilingResponseSchema.parse(completed());
  const response: MaelstromResponse = {
    ...candidate,
    type: 'maelstrom_response',
    requestId: MessageId('scorer-control'),
    layout: { type: 'tiling', ...candidate.layout },
  };
  expect(scoreD17Response(undefined, initial).outcome).toBe('fail');
  expect(scoreD17Response(response, initial).outcome).toBe('pass');
  const reordered: MaelstromResponse = {
    ...response,
    layout: {
      type: 'tiling',
      ...candidate.layout,
      instances: [...initial.instances].reverse(),
    },
  };
  expect(scoreD17Response(reordered, initial).failures).toContain(
    'Chart Instance snapshots changed',
  );
  const differentVessel = TilingResponseSchema.parse({
    ...completed(),
    layout: {
      ...completed().layout,
      instances: [{ ...instances[0], vesselId: 'calendar' }, instances[1]],
    },
  });
  expect(
    scoreD17Response(
      { ...response, layout: { type: 'tiling', ...differentVessel.layout } },
      initial,
    ).outcome,
  ).toBe('fail');
  expect(
    scoreD17Response(
      { ...response, layout: { type: 'grid', positions: [] } },
      initial,
    ).failures,
  ).toEqual(['Chart layout changed', 'Chart Instance snapshots changed']);
  expect(initial).toEqual(await d17Request());
});

test('D17 uses shipped evidence, not unhealed candidate safety or client execution', async () => {
  const { send } = scripted({
    ...completed(),
    executionPlan: [{ instanceId: 'ghost', action: 'invented' }],
  });
  const report = await runD17(args, env, send);
  if (report.mode !== 'live') throw new Error('Expected execution');
  expect(report.generationDispatches).toBe(1);
  expect(report.result.evaluation).toBe('pass');
  expect(report.result.observation?.executionPlan).toEqual([]);
  expect(report.limitation).toContain(
    'Engine healing may change the raw candidate',
  );
});

test('D17 malformed/truncated/HTTP/network failures end after one request and never log credentials', async () => {
  for (const failure of [
    () => new Response(`rejected ${env.OPENAI_API_KEY}`, { status: 401 }),
    () => new Response('limit', { status: 429 }),
    () => new Response('error', { status: 503 }),
    () => {
      throw new Error(`network ${env.OPENAI_API_KEY}`);
    },
    () => sse(completed('')),
    () => sse(completed(' \n\t ')),
    () => sse({ userMessage: clarification }),
    () => sse({ ...completed(), executionPlan: undefined }),
    () => sse({ ...completed(), userMessage: 7 }),
    () =>
      new Response('data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    () =>
      new Response(
        'data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  ]) {
    const send = mock<ManualFetch>(async () => failure());
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const report = await runD17(args, env, send);
      if (report.mode !== 'live') throw new Error('Expected execution');
      expect(send).toHaveBeenCalledTimes(1);
      expect(report.generationDispatches).toBe(1);
      expect(report.result).toMatchObject({
        execution: 'error',
        evaluation: 'unscored',
        completeness: 'absent',
        records: [],
      });
      expect(report.semanticReview.status).toBe('unavailable');
      expect(report.semanticReview).not.toHaveProperty('assistantText');
      expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  }
});

test('D17 transport stays closed after its only turn and after unsafe wire attempts', async () => {
  const { send, requests, bodies } = scripted();
  await runD17(args, env, send);
  const outgoing = (changes: Record<string, unknown> = {}) =>
    new Request(requests[0].url, {
      method: requests[0].method,
      headers: requests[0].headers,
      body: JSON.stringify({ ...bodies[0], ...changes }),
    });
  const deliver = mock<ManualFetch>(async () => sse(completed()));
  const guard = manualTransport(
    deliver,
    env.OPENAI_API_KEY,
    'gpt-6-luna',
    2048,
    1,
  );
  guard.beginTurn(0);
  await guard.fetch(outgoing());
  guard.assertDispatched();
  expect(() => guard.beginTurn(1)).toThrow();
  await expect(guard.fetch(outgoing())).rejects.toThrow();
  expect(deliver).toHaveBeenCalledTimes(1);
  for (const change of [
    { model: 'other' },
    { tools: [] },
    { conversation: 'remote' },
    { previous_response_id: 'remote' },
    { include: ['reasoning.encrypted_content'] },
    { max_output_tokens: 4096 },
    { store: true },
    { service_tier: 'priority' },
  ]) {
    const denied = mock<ManualFetch>();
    const guard = manualTransport(
      denied,
      env.OPENAI_API_KEY,
      'gpt-6-luna',
      2048,
      1,
    );
    guard.beginTurn(0);
    await expect(guard.fetch(outgoing(change))).rejects.toThrow();
    expect(denied).not.toHaveBeenCalled();
  }
});
