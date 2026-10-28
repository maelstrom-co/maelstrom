import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import type { LLMContextMessage } from '@maelstrom-co/engine';
import { buildSystemPrompt } from '@maelstrom-co/planner-llm';
import { VariantName, VesselSchema } from '@maelstrom-co/protocol';
import { SYSTEM_RULES } from '../plugins/llm/plugin.js';
import { type ManualFetch, manualTransport } from './transport.js';
import {
  runWeatherSample,
  scoreWeatherTurns,
  type WeatherSampleCase,
} from './weather.js';

const env = { OPENAI_API_KEY: 'synthetic-weather-test-key' };
const selectedCases = ['D38', 'D39', 'D40', 'D41'] as const;
const chainCases = ['D40', 'D41'] as const;
const intents = {
  D38: ['Show current weather'],
  D39: ['Skip to weekly forecast'],
  D40: [
    'Show me the hourly forecast',
    'Now go straight to weekly',
    'Go back to current',
  ],
  D41: [
    'Show hourly',
    'Just show current right now - skip weekly',
    'Go to weekly',
  ],
};
function flags(selected: WeatherSampleCase) {
  return ['--case', selected, '--live', '--confirm-capped-key'];
}
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in Weather sample tests');
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
function candidate(userMessage: string, variant: string, action?: string) {
  return {
    userMessage,
    rationale: 'Synthetic response, not a model result',
    executionPlan: action ? [{ instanceId: 'weather-main', action }] : [],
    layout: {
      type: 'tiling',
      tree: ['ID:weather-main'],
      instances: [{ instanceId: 'weather-main', vesselId: 'weather', variant }],
    },
  };
}
function replies(selected: WeatherSampleCase) {
  switch (selected) {
    case 'D38':
      return [
        candidate(
          'Already current. Would you like hourly or weekly instead?',
          'current',
        ),
      ];
    case 'D39':
      return [candidate('Synthetic weekly selection.', 'weekly', 'showWeekly')];
    case 'D40':
      return [
        candidate('Synthetic hourly selection.', 'hourly', 'showHourly'),
        candidate('Synthetic weekly selection.', 'weekly', 'showWeekly'),
        candidate('Synthetic current selection.', 'current', 'showCurrent'),
      ];
    case 'D41':
      return [
        candidate('Synthetic hourly selection.', 'hourly', 'showHourly'),
        candidate('Synthetic current selection.', 'current', 'showCurrent'),
        candidate('Synthetic weekly selection.', 'weekly', 'showWeekly'),
      ];
  }
}
function event(
  value: unknown,
  type = 'response.completed',
  status = 'completed',
) {
  return {
    type,
    response: {
      id: 'synthetic-weather-response',
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
    events.map((value) => `data: ${JSON.stringify(value)}\n\n`).join('') +
      'data: [DONE]\n\n',
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}
function sse(value: unknown) {
  return stream(event(value));
}
function scripted(responses: ReturnType<typeof replies>) {
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
async function evidence(selected: WeatherSampleCase) {
  const transport = scripted(replies(selected));
  const report = await runWeatherSample(flags(selected), env, transport.send);
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

test('Weather dry-runs select exactly one canonical prompt sequence and actual current catalog, with unchanged prompt and no key access', async () => {
  for (const selected of selectedCases) {
    const send = mock<ManualFetch>();
    const report = await runWeatherSample(
      ['--case', selected],
      {
        get OPENAI_API_KEY(): string {
          throw new Error('Must not read credentials');
        },
      },
      send,
    );
    expect(report.mode).toBe('dry-run');
    expect(report.generationDispatches).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(report.configuration).toMatchObject({
      sample: selected,
      model: 'gpt-6-luna',
      prompts: intents[selected],
      engineRetries: 0,
      sdkRetries: 0,
      maxGenerationDispatches: intents[selected].length,
      budget: 'external capped key; not verified by this script',
    });
    expect(report.configuration.systemPrompt).toBe(
      buildSystemPrompt('tiling', {
        system: { rules: { append: SYSTEM_RULES } },
      }),
    );
    for (const intent of intents[selected])
      expect(report.configuration.systemPrompt).not.toContain(intent);
    const weather: { weatherVessel: unknown } = await import(
      new URL(
        '../../../../apps/demo/src/vessels/weather.vessel.def.ts',
        import.meta.url,
      ).href
    );
    const initial = report.configuration.initialRequest;
    expect(initial.vessels).toEqual([
      VesselSchema.parse(weather.weatherVessel),
    ]);
    expect(initial).toMatchObject({
      type: 'chart_request',
      context: {
        layoutMode: 'tiling',
        chartDimensions: { columns: 30, rows: 18 },
        updateReasons: [{ type: 'user_intent', intent: intents[selected][0] }],
      },
      instances: [
        { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
      ],
      layout: {
        type: 'tiling',
        tree: ['ID:weather-main'],
        instances: [
          {
            instanceId: 'weather-main',
            vesselId: 'weather',
            variant: 'current',
          },
        ],
      },
    });
    const source = JSON.parse(
      fs.readFileSync(
        new URL(
          `../../cases/v1/${report.configuration.caseId}.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(
      selected === 'D38' || selected === 'D39'
        ? [source.inputs.intent]
        : source.inputs.turns.map((turn: { intent: string }) => turn.intent),
    ).toEqual(intents[selected]);
    expect(source.review).toBe('pending-human-review');
    expect(source.purpose).toContain('COMPLETE');
    expect(source.lineage).toEqual(report.configuration.source);
    expect(source.lineage[0].pointer).toBe(
      {
        D38: '/items/37',
        D39: '/items/38',
        D40: '/items/39',
        D41: '/items/40',
      }[selected],
    );
  }
});

test.each(
  chainCases,
)('%s rejects canonical trajectory, prompt or lineage cross-wiring before dispatch', async (selected) => {
  const other = selected === 'D40' ? 'D41' : 'D40';
  const files = {
    D40: 'weather-deterministic-cycle',
    D41: 'weather-deterministic-return',
  };
  const path = new URL(
    `../../cases/v1/${files[selected]}.json`,
    import.meta.url,
  );
  const source = JSON.parse(fs.readFileSync(path, 'utf8'));
  const alternate = JSON.parse(
    fs.readFileSync(
      new URL(`../../cases/v1/${files[other]}.json`, import.meta.url),
      'utf8',
    ),
  );
  const read = fs.readFileSync;
  const send = mock<ManualFetch>();
  for (const field of ['expectations', 'inputs', 'lineage'] as const) {
    const changed = { ...source, [field]: alternate[field] };
    const file = spyOn(fs, 'readFileSync').mockImplementation(((...args) => {
      if (String(args[0]) === path.href && args[1] === 'utf8')
        return JSON.stringify(changed);
      return Reflect.apply(read, fs, args);
    }) as typeof fs.readFileSync);
    try {
      await expect(
        runWeatherSample(flags(selected), env, send),
      ).rejects.toThrow(
        'Weather case contract changed; review before dispatch',
      );
    } finally {
      file.mockRestore();
    }
  }
  expect(send).not.toHaveBeenCalled();
});

test('Weather CLI/import do not dispatch implicitly and only accept explicit single-case selection', () => {
  const path = `${import.meta.dir}/weather.ts`;
  for (const tail of [
    [
      '-e',
      `globalThis.fetch = () => { throw new Error('unexpected network'); }; await import(${JSON.stringify(path)});`,
    ],
    [path, '--case', 'D38'],
    [path, '--case', 'D39'],
    [path, '--case', 'D40'],
    [path, '--case', 'D41'],
  ]) {
    const result = Bun.spawnSync(
      [
        process.execPath,
        '--no-env-file',
        '--conditions=@maelstrom-co/source',
        ...tail,
      ],
      { env: {}, timeout: 10000, killSignal: 'SIGKILL' },
    );
    expect(
      result.exitCode,
      `Weather subprocess ${JSON.stringify(tail)}: signal=${result.signalCode}, timeout=${result.exitedDueToTimeout}, stderr=${result.stderr.toString()}`,
    ).toBe(0);
    expect(result.stderr.toString()).toBe('');
    if (tail[0] === '-e') expect(result.stdout.toString()).toBe('');
    else expect(JSON.parse(result.stdout.toString()).mode).toBe('dry-run');
  }
  for (const args of [
    [],
    ['--case', 'D42'],
    ['--case', 'D38', '--case', 'D41'],
  ]) {
    const result = Bun.spawnSync(
      [
        process.execPath,
        '--no-env-file',
        '--conditions=@maelstrom-co/source',
        path,
        ...args,
      ],
      { env: {}, timeout: 10000, killSignal: 'SIGKILL' },
    );
    expect(
      result.exitCode,
      `Weather subprocess ${JSON.stringify(args)}: signal=${result.signalCode}, timeout=${result.exitedDueToTimeout}, stderr=${result.stderr.toString()}`,
    ).toBe(1);
    expect(result.stdout.toString()).toBe('');
    expect(result.stderr.toString()).toContain('Weather sample did not start');
  }
}, 30000);

test('unknown/duplicate selectors, flags, model/endpoint drift and missing live acknowledgement/key fail before any send', async () => {
  const send = mock<ManualFetch>();
  for (const args of [
    [],
    ['--live', '--confirm-capped-key'],
    ['D38'],
    ['--case'],
    ['--case=D38'],
    ['--case', 'D42'],
    ['--case', 'all'],
    ['--case', 'D38', 'D41'],
    ['--case', 'D38', '--case', 'D38'],
    ['--case', 'D38', '--case', 'D41'],
    ['--case', 'D41', '--case', 'D38'],
    ['--case', 'D40', '--case', 'D41'],
    ['--case', 'D40', '--case', 'D40'],
    ['--case', '--live'],
    ['--case', 'D38', '--live'],
    ['--case', 'D38', '--confirm-capped-key'],
    ['--case', 'D39', '--live'],
    ['--case', 'D39', '--confirm-capped-key'],
    [...flags('D39'), '--live'],
    ['--case', 'D40', '--live'],
    ['--case', 'D40', '--confirm-capped-key'],
    [...flags('D40'), '--live'],
    [...flags('D40'), '--confirm-capped-key'],
    [...flags('D41'), '--live'],
    [...flags('D41'), '--confirm-capped-key'],
    [...flags('D38'), '--grader'],
  ])
    await expect(runWeatherSample(args, env, send)).rejects.toThrow();
  for (const selected of selectedCases)
    for (const config of [
      {},
      { OPENAI_API_KEY: ' ' },
      { ...env, ENGINE_MODEL: 'other' },
      { ...env, OPENAI_BASE_URL: 'https://elsewhere.invalid' },
      { ...env, OPENAI_CUSTOM_HEADERS: 'X-Test: value' },
    ])
      await expect(
        runWeatherSample(flags(selected), config, send),
      ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

test('current Engine performs only selected turns and passes actual prior replies to the provider without prompt modification', async () => {
  for (const selected of selectedCases) {
    const { report, turns, requests, bodies } = await evidence(selected);
    expect(report.result).toMatchObject({
      execution: 'completed',
      completeness: 'complete',
      failures: [],
    });
    expect(report.generationDispatches).toBe(intents[selected].length);
    expect(requests).toHaveLength(intents[selected].length);
    expect<unknown>(
      turns.map(({ response }) => response.executionPlan),
    ).toEqual(
      {
        D38: [[]],
        D39: [[{ instanceId: 'weather-main', action: 'showWeekly' }]],
        D40: [
          [{ instanceId: 'weather-main', action: 'showHourly' }],
          [{ instanceId: 'weather-main', action: 'showWeekly' }],
          [{ instanceId: 'weather-main', action: 'showCurrent' }],
        ],
        D41: [
          [{ instanceId: 'weather-main', action: 'showHourly' }],
          [{ instanceId: 'weather-main', action: 'showCurrent' }],
          [{ instanceId: 'weather-main', action: 'showWeekly' }],
        ],
      }[selected],
    );
    expect<unknown>(
      turns.map(({ request }) => request.instances[0].variant),
    ).toEqual(
      {
        D38: ['current'],
        D39: ['current'],
        D40: ['current', 'hourly', 'weekly'],
        D41: ['current', 'hourly', 'current'],
      }[selected],
    );
    expect<unknown>(
      turns.map(({ response }) =>
        response.layout.type === 'tiling'
          ? response.layout.instances[0].variant
          : undefined,
      ),
    ).toEqual(
      {
        D38: ['current'],
        D39: ['weekly'],
        D40: ['hourly', 'weekly', 'current'],
        D41: ['hourly', 'current', 'weekly'],
      }[selected],
    );
    const prior: LLMContextMessage[] = [];
    for (const [index, body] of bodies.entries()) {
      expect(requests[index].url).toBe('https://api.openai.com/v1/responses');
      expect(requests[index].method).toBe('POST');
      expect(requests[index].redirect).toBe('error');
      expect(body).toMatchObject({
        model: 'gpt-6-luna',
        max_output_tokens: 2048,
        stream: true,
        service_tier: 'default',
        store: false,
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
      expect(body.input).toHaveLength(index * 2 + 1);
      expect(turns[index].history).toEqual(prior);
      expect(body.input.slice(0, -1).map(({ role }) => role)).toEqual(
        prior.map(({ role }) => role),
      );
      for (const [i, message] of prior.entries())
        expect(JSON.stringify(body.input[i].content)).toContain(
          message.content,
        );
      expect(body.input.at(-1)?.role).toBe('user');
      expect(JSON.stringify(body.input.at(-1)?.content)).toContain(
        intents[selected][index],
      );
      expect(turns[index].request.context.updateReasons).toEqual([
        { type: 'user_intent', intent: intents[selected][index] },
      ]);
      expect(turns[index].request.layout).toEqual(
        index === 0
          ? report.configuration.initialRequest.layout
          : turns[index - 1].response.layout,
      );
      expect(turns[index].request.vessels).toEqual(
        report.configuration.initialRequest.vessels,
      );
      expect(turns[index].response.userMessage).toBe(
        replies(selected)[index].userMessage,
      );
      expect(turns[index].requestId).toContain(report.result.identity.runId);
      prior.push(
        { role: 'user', content: intents[selected][index] },
        { role: 'assistant', content: turns[index].response.userMessage },
      );
    }
    expect(new Set(turns.map(({ requestId }) => requestId)).size).toBe(
      turns.length,
    );
    expect(report.result.records.map(({ kind }) => kind)).toEqual(
      turns.flatMap(() => ['diagnostic', 'turn']),
    );
    expect(report.semanticReview.status).toBe('pending-human-review');
    expect(report.semanticReview.assistantTexts).toEqual(
      replies(selected).map(({ userMessage }) => userMessage),
    );
    expect(report.limitation).toContain('not semantic option offering');
    expect(report.limitation).toContain('COMPLETE');
    expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
  }
});

test('D38 rejects every shipped Action or Chart mutation even when prose offers options', async () => {
  const { turns, report } = await evidence('D38');
  const initial = report.configuration.initialRequest;
  for (const mutate of [
    (turn: (typeof turns)[number]) =>
      Object.assign(turn.response, {
        executionPlan: [{ instanceId: 'weather-main', action: 'showHourly' }],
      }),
    (turn: (typeof turns)[number]) =>
      Object.assign(turn.response, {
        executionPlan: [
          {
            instanceId: 'weather-main',
            action: 'setLocation',
            params: { location: 'Paris' },
          },
        ],
      }),
    (turn: (typeof turns)[number]) =>
      Object.assign(turn.response.layout, { tree: [] }),
    (turn: (typeof turns)[number]) =>
      Object.assign(turn.response.layout, {
        tree: ['V:2,1', 'ID:weather-main', null],
      }),
    (turn: (typeof turns)[number]) =>
      Object.assign(turn.response.layout, { type: 'grid', positions: [] }),
    (turn: (typeof turns)[number]) =>
      Object.assign(turn.response.layout, { instances: [] }),
    (turn: (typeof turns)[number]) =>
      Object.assign(turn.response.layout, {
        instances: [
          {
            instanceId: 'weather-main',
            vesselId: 'weather',
            variant: 'hourly',
          },
        ],
      }),
    (turn: (typeof turns)[number]) =>
      Object.assign(turn.response.layout, {
        instances: [...initial.instances, ...initial.instances],
      }),
    (turn: (typeof turns)[number]) =>
      Object.assign(turn.response.layout, {
        instances: [
          { instanceId: 'other', vesselId: 'weather', variant: 'current' },
        ],
      }),
  ]) {
    const changed = structuredClone(turns);
    mutate(changed[0]);
    expect(scoreWeatherTurns('D38', changed, initial).outcome).toBe('fail');
  }
  const unrelated = [
    candidate('I have changed everything. This is unrelated prose.', 'current'),
  ];
  const result = await runWeatherSample(
    flags('D38'),
    env,
    scripted(unrelated).send,
  );
  if (result.mode !== 'live') throw new Error('Expected execution');
  expect(result.result.evaluation).toBe('pass');
  expect(result.semanticReview.status).toBe('pending-human-review');
});

test.each(
  chainCases,
)('%s checks exact plans, pre-turn Action validity, complete retained snapshots and layout independently of prose', async (selected) => {
  const { turns, report } = await evidence(selected);
  const initial = report.configuration.initialRequest;
  for (let index = 0; index < 3; index++) {
    for (const plan of [
      [],
      [
        ...turns[index].response.executionPlan,
        ...turns[index].response.executionPlan,
      ],
      [
        {
          instanceId: 'other',
          action: turns[index].response.executionPlan[0].action,
        },
      ],
      [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Paris' },
        },
      ],
      [
        {
          instanceId: 'weather-main',
          action: turns[index].response.executionPlan[0].action,
          params: {},
        },
      ],
      [
        ...turns[index].response.executionPlan,
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Paris' },
        },
      ],
    ]) {
      const changed = structuredClone(turns);
      Object.assign(changed[index].response, { executionPlan: plan });
      expect(scoreWeatherTurns(selected, changed, initial).failures).toContain(
        `Execution Plan mismatch at turn ${index + 1}`,
      );
    }
    for (const layout of [
      {
        type: 'tiling',
        tree: [],
        instances: replies(selected)[index].layout.instances,
      },
      {
        type: 'tiling',
        tree: ['ID:weather-main'],
        instances: [
          {
            instanceId: 'weather-main',
            vesselId: 'weather',
            variant: 'unexpected',
          },
        ],
      },
      {
        type: 'tiling',
        tree: ['ID:weather-main'],
        instances: [
          {
            instanceId: 'weather-main',
            vesselId: 'other',
            variant: replies(selected)[index].layout.instances[0].variant,
          },
        ],
      },
      {
        type: 'tiling',
        tree: ['ID:weather-main'],
        instances: [
          ...replies(selected)[index].layout.instances,
          { instanceId: 'extra', vesselId: 'weather', variant: 'current' },
        ],
      },
    ]) {
      const changed = structuredClone(turns);
      Object.assign(changed[index].response, { layout });
      expect(scoreWeatherTurns(selected, changed, initial).outcome).toBe(
        'fail',
      );
    }
  }
  const invalidSource = structuredClone(turns);
  Object.assign(invalidSource[0].request.instances[0], { variant: 'hourly' });
  expect(
    scoreWeatherTurns(selected, invalidSource, initial).failures,
  ).toContain('Action unavailable for incoming Variant at turn 1');
  const invalidTable = structuredClone(turns);
  for (const variant of Object.values(
    invalidTable[0].request.vessels[0].variants,
  ))
    Object.assign(variant, { actions: [] });
  expect(scoreWeatherTurns(selected, invalidTable, initial).failures).toContain(
    'Action unavailable for incoming Variant at turn 1',
  );
});

test.each(
  chainCases,
)('%s rejects the other chain despite valid Actions, carry-forward and history', async (selected) => {
  const other = selected === 'D40' ? 'D41' : 'D40';
  const transport = scripted(replies(other));
  const report = await runWeatherSample(flags(selected), env, transport.send);
  if (report.mode !== 'live') throw new Error('Expected execution');
  expect(report.result).toMatchObject({
    execution: 'completed',
    completeness: 'complete',
    evaluation: 'fail',
  });
  expect(report.generationDispatches).toBe(3);
  expect(transport.requests).toHaveLength(3);
  expect(report.result.failures).toEqual([
    'Execution Plan mismatch at turn 2',
    'Chart layout/Instance snapshot mismatch at turn 2',
    'Execution Plan mismatch at turn 3',
    'Action unavailable for incoming Variant at turn 3',
    'Chart layout/Instance snapshot mismatch at turn 3',
  ]);
  expect(report.semanticReview.status).toBe('pending-human-review');
});

test('all predicates reject incomplete/extra/reordered requests or corrupted history and carry-forward', async () => {
  for (const selected of selectedCases) {
    const { turns, report } = await evidence(selected);
    const initial = report.configuration.initialRequest;
    for (const changed of [[], turns.slice(0, -1), [...turns, turns[0]]])
      expect(scoreWeatherTurns(selected, changed, initial).outcome).toBe(
        'fail',
      );
    for (let index = 0; index < turns.length; index++) {
      for (const mutate of [
        (turn: (typeof turns)[number]) => Object.assign(turn, { index: 42 }),
        (turn: (typeof turns)[number]) =>
          Object.assign(turn, {
            history: [{ role: 'assistant', content: 'Injected or reordered' }],
          }),
        (turn: (typeof turns)[number]) =>
          Object.assign(turn.request.context, {
            updateReasons: [{ type: 'user_intent', intent: 'Wrong prompt' }],
          }),
        (turn: (typeof turns)[number]) =>
          Object.assign(turn.request.context.chartDimensions, { columns: 20 }),
        (turn: (typeof turns)[number]) =>
          Object.assign(turn.request.instances[0], { variant: 'unexpected' }),
      ]) {
        const changed = structuredClone(turns);
        mutate(changed[index]);
        expect(scoreWeatherTurns(selected, changed, initial).outcome).toBe(
          'fail',
        );
      }
    }
    if (intents[selected].length > 1)
      expect(
        scoreWeatherTurns(selected, [...turns].reverse(), initial).outcome,
      ).toBe('fail');
  }
});

test('failed predicates never replace actual carry-forward with expected state, and each selection gets fresh state/history', async () => {
  const changed = replies('D41');
  changed[0] = candidate('Kept current instead.', 'current');
  changed[1] = candidate('Still current.', 'current');
  const first = await runWeatherSample(
    flags('D41'),
    env,
    scripted(changed).send,
  );
  if (first.mode !== 'live') throw new Error('Expected execution');
  expect(first.result.evaluation).toBe('fail');
  expect(first.result.observation?.[1].request.instances[0].variant).toBe(
    VariantName('current'),
  );
  expect(first.configuration.initialRequest.instances[0].variant).toBe(
    VariantName('current'),
  );
  for (const selected of selectedCases) {
    const next = await evidence(selected);
    expect(next.report.result.identity.runId).not.toBe(
      first.result.identity.runId,
    );
    expect(next.turns[0].history).toEqual([]);
    expect(next.turns[0].request.instances[0].variant).toBe(
      VariantName('current'),
    );
  }
});

test('Engine-healed output is distinct from raw candidate safety and does not invoke a retry', async () => {
  for (const selected of selectedCases) {
    const changed = replies(selected);
    changed[0].executionPlan.push({ instanceId: 'ghost', action: 'invented' });
    const report = await runWeatherSample(
      flags(selected),
      env,
      scripted(changed).send,
    );
    if (report.mode !== 'live') throw new Error('Expected execution');
    expect(report.result.evaluation).toBe('pass');
    expect(report.generationDispatches).toBe(intents[selected].length);
  }
});

test('provider errors, incomplete/malformed streams and timeouts are terminal, unscored and sanitized', async () => {
  for (const selected of selectedCases)
    for (const fail of [
      () =>
        new Response(
          JSON.stringify({ error: { message: env.OPENAI_API_KEY } }),
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
          delta: JSON.stringify(replies(selected)[0]),
        }),
      () =>
        stream(
          event(replies(selected)[0], 'response.incomplete', 'incomplete'),
        ),
      () => stream(event(replies(selected)[0], 'response.failed', 'failed')),
    ]) {
      let calls = 0;
      const log = spyOn(console, 'error').mockImplementation(() => {});
      try {
        const report = await runWeatherSample(
          flags(selected),
          env,
          async () => {
            calls++;
            return intents[selected].length > 1 && calls === 1
              ? sse(replies(selected)[0])
              : fail();
          },
        );
        if (report.mode !== 'live') throw new Error('Expected execution');
        expect(calls).toBe(intents[selected].length === 1 ? 1 : 2);
        expect(report.generationDispatches).toBe(calls);
        expect(report.result).toMatchObject({
          execution: 'error',
          evaluation: 'unscored',
          completeness: intents[selected].length === 1 ? 'absent' : 'partial',
        });
        expect(report.result.observation).toHaveLength(calls - 1);
        expect(
          report.result.records.filter(({ kind }) => kind === 'turn'),
        ).toHaveLength(calls - 1);
        expect(report.semanticReview.status).toBe('unavailable');
        expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
        expect(log).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    }
});

test('D40/D41 first-turn failure stops before other turns and abort never accepts a late complete response', async () => {
  for (const selected of chainCases) {
    const send = mock<ManualFetch>(
      async () => new Response('unavailable', { status: 503 }),
    );
    const report = await runWeatherSample(flags(selected), env, send);
    if (report.mode !== 'live') throw new Error('Expected execution');
    expect(report.result.completeness).toBe('absent');
    expect(report.result.records).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  }
  for (const selected of selectedCases) {
    const controller = new AbortController();
    const timeout = spyOn(AbortSignal, 'timeout').mockReturnValue(
      controller.signal,
    );
    const late = mock<ManualFetch>(async () => {
      controller.abort();
      return sse(replies(selected)[0]);
    });
    try {
      const result = await runWeatherSample(flags(selected), env, late);
      if (result.mode !== 'live') throw new Error('Expected execution');
      expect(result.result.evaluation).toBe('unscored');
      expect(result.result.completeness).toBe('absent');
      expect(late).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  }
});

function wire() {
  return new Request('https://api.openai.com/v1/responses', {
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
      instructions: 'Synthetic',
      input: [{ role: 'user', content: 'Synthetic' }],
      text: { format: { type: 'json_schema', strict: true, schema: {} } },
    }),
  });
}
test('shared transport enforces D38/D39 one-turn and D40/D41 three-turn limits, including concurrent duplicate sends', async () => {
  for (const maxTurns of [1, 3] as const) {
    const send = mock<ManualFetch>(async () => sse(replies('D38')[0]));
    const transport = manualTransport(
      send,
      env.OPENAI_API_KEY,
      'gpt-6-luna',
      2048,
      maxTurns,
    );
    for (let index = 0; index < maxTurns; index++) {
      transport.beginTurn(index);
      await transport.fetch(wire());
      transport.assertDispatched();
    }
    expect(() => transport.beginTurn(maxTurns)).toThrow();
    await expect(transport.fetch(wire())).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(maxTurns);
    const duplicate = manualTransport(
      send,
      env.OPENAI_API_KEY,
      'gpt-6-luna',
      2048,
      maxTurns,
    );
    duplicate.beginTurn(0);
    const results = await Promise.allSettled([
      duplicate.fetch(wire()),
      duplicate.fetch(wire()),
    ]);
    expect(results.some(({ status }) => status === 'rejected')).toBe(true);
    expect(duplicate.count()).toBeLessThanOrEqual(1);
    expect(() => duplicate.beginTurn(1)).toThrow();
  }
});

test('D39 validates canonical prompt, predicate and lineage before any dispatch', async () => {
  const path = new URL(
    '../../cases/v1/weather-action-backed-transition.json',
    import.meta.url,
  );
  const source = JSON.parse(fs.readFileSync(path, 'utf8'));
  const read = fs.readFileSync;
  const send = mock<ManualFetch>();
  for (const overrides of [
    { inputs: { intent: 'Show current weather' } },
    { expectations: { rule: 'any-nonempty-plan', coverage: 'COMPLETE' } },
    { lineage: [{ ...source.lineage[0], pointer: '/items/39' }] },
    { profile: 'legacy-weather-transition-chain' },
  ]) {
    const file = spyOn(fs, 'readFileSync').mockImplementation(((...args) => {
      if (String(args[0]) === path.href && args[1] === 'utf8')
        return JSON.stringify({ ...source, ...overrides });
      return Reflect.apply(read, fs, args);
    }) as typeof fs.readFileSync);
    try {
      await expect(runWeatherSample(flags('D39'), env, send)).rejects.toThrow();
    } finally {
      file.mockRestore();
    }
  }
  expect(send).not.toHaveBeenCalled();
});

test('D39 scores the matching transition and identity without importing D40/D41 exact-plan or geometry constraints', async () => {
  const { turns, report } = await evidence('D39');
  const initial = report.configuration.initialRequest;
  for (const executionPlan of [
    [],
    [{ instanceId: 'weather-main', action: 'showCurrent' }],
    [{ instanceId: 'elsewhere', action: 'showWeekly' }],
  ]) {
    const changed = structuredClone(turns);
    Object.assign(changed[0].response, { executionPlan });
    expect(scoreWeatherTurns('D39', changed, initial).outcome).toBe('fail');
  }
  for (const instances of [
    [],
    [{ instanceId: 'weather-new', vesselId: 'weather', variant: 'weekly' }],
    [{ instanceId: 'weather-main', vesselId: 'weather', variant: 'current' }],
    [{ instanceId: 'weather-main', vesselId: 'calendar', variant: 'weekly' }],
  ]) {
    const changed = structuredClone(turns);
    Object.assign(changed[0].response.layout, { instances });
    expect(scoreWeatherTurns('D39', changed, initial).outcome).toBe('fail');
  }
  const changed = structuredClone(turns);
  Object.assign(changed[0].response, {
    executionPlan: [
      {
        instanceId: 'foreign',
        action: 'unscored',
        params: { arbitrary: [1, true] },
      },
      {
        instanceId: 'weather-main',
        action: 'showWeekly',
        params: { arbitrary: { nested: true } },
      },
    ],
  });
  Object.assign(changed[0].response.layout, {
    tree: ['V:2,1', 'ID:weather-main', null],
  });
  expect(scoreWeatherTurns('D39', changed, initial).outcome).toBe('pass');
  expect(report.generationDispatches).toBe(1);
  expect(report.configuration.maxGenerationDispatches).toBe(1);
  expect(report.configuration.source[0]).toMatchObject({
    pointer: '/items/38',
  });
  expect(report.limitation).toContain(
    'extra Actions, parameters, other Instances and geometry are unscored',
  );
});
