import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import type { LLMContextMessage } from '@maelstrom-co/engine';
import { buildSystemPrompt, buildUserPrompt } from '@maelstrom-co/planner-llm';
import {
  ActionName,
  InstanceId,
  VariantName,
  VesselSchema,
} from '@maelstrom-co/protocol';
import { SYSTEM_RULES } from '../plugins/llm/plugin.js';
import { type D35Turn, runD35, scoreD35Turns } from './d35.js';
import type { ManualFetch } from './transport.js';

type MutableTurn = { -readonly [K in keyof D35Turn]: D35Turn[K] };

const env = { OPENAI_API_KEY: 'synthetic-d35-test-key' };
const args = ['--live', '--confirm-capped-key'];
const intents = [
  'Add my lab results and calendar to the weather view.',
  'Switch the weather to weekly forecast.',
  'Show me the week view in the calendar.',
];
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in D35 tests');
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

function replies() {
  return [0, 1, 2].map((index) => ({
    userMessage: 'Synthetic navigation only. No lab results available.',
    rationale: 'Independent synthetic response, not a model result',
    executionPlan:
      index === 0
        ? []
        : [
            {
              instanceId: index === 1 ? 'weather-main' : 'calendar-main',
              action: index === 1 ? 'showWeekly' : 'showWeek',
            },
          ],
    layout: {
      type: 'tiling',
      tree: ['V:1,1,1', 'ID:weather-main', 'ID:labs-main', 'ID:calendar-main'],
      instances: [
        {
          instanceId: 'weather-main',
          vesselId: 'weather',
          variant: index === 0 ? 'current' : 'weekly',
        },
        { instanceId: 'labs-main', vesselId: 'labs', variant: 'trends' },
        {
          instanceId: 'calendar-main',
          vesselId: 'calendar',
          variant: index === 2 ? 'week' : 'month',
        },
      ],
    },
  }));
}
function sse(value: unknown, status = 'completed') {
  const event = {
    type: status === 'completed' ? 'response.completed' : 'response.incomplete',
    response: {
      id: 'synthetic-d35-response',
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
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}
function scripted(responses = replies()) {
  const requests: Request[] = [];
  const bodies: Array<{
    instructions: string;
    input: Array<{ role: string; content: unknown }>;
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
  const report = await runD35(args, env, transport.send);
  if (report.mode !== 'live' || !report.result.observation)
    throw new Error('Missing synthetic evidence');
  expect(report.result.evaluation).toBe('pass');
  return {
    report,
    turns: structuredClone(report.result.observation) as MutableTurn[],
    ...transport,
  };
}

test('D35 dry-run uses three source prompts, actual catalogs and adjudicated Weather-only start without credentials', async () => {
  const send = mock<ManualFetch>();
  const report = await runD35(
    [],
    {
      get OPENAI_API_KEY(): string {
        throw new Error('Must not read key');
      },
    },
    send,
  );
  expect(report.mode).toBe('dry-run');
  expect(report.generationDispatches).toBe(0);
  expect(send).not.toHaveBeenCalled();
  expect(report.configuration).toMatchObject({
    sample: 'D35',
    model: 'gpt-6-luna',
    prompts: intents,
    initialScene: 'user-adjudicated-weather-only',
    labsPreservationBaseline: 'after-addition',
    engineRetries: 0,
    sdkRetries: 0,
    maxGenerationDispatches: 3,
    source: [{ pointer: '/items/34' }],
  });
  expect(report.configuration.systemPrompt).toBe(
    buildSystemPrompt('tiling', {
      system: { rules: { append: SYSTEM_RULES } },
    }),
  );
  expect(report.configuration.systemPrompt).toContain(
    'use the catalog-declared defaultVariant (marked "(default)") as its initial Variant',
  );
  expect(report.configuration.systemPrompt).toContain(
    'An explicitly requested Variant takes precedence over the default',
  );
  expect(report.configuration.systemPrompt).toContain(
    'the target is ambiguous, the requested capability is unsupported, required configuration is missing',
  );
  expect(report.configuration.systemPrompt).toContain(
    'a change to an existing Instance has no clear intended resulting state',
  );
  expect(report.configuration.systemPrompt).not.toContain(
    'empty default trends view',
  );
  for (const value of [...intents, 'D35', 'labs-main'])
    expect(report.configuration.systemPrompt).not.toContain(value);
  const catalogs = [];
  for (const name of ['weather', 'labs', 'calendar']) {
    const module = await import(
      new URL(
        `../../../../apps/demo/src/vessels/${name}.vessel.def.ts`,
        import.meta.url,
      ).href
    );
    catalogs.push(VesselSchema.parse(module[`${name}Vessel`]));
  }
  expect(report.configuration.initialRequest.vessels).toEqual(catalogs);
  const userPrompt = buildUserPrompt(report.configuration.initialRequest);
  expect(userPrompt).toContain('empty default trends view');
  expect(userPrompt).toContain(
    'Opening the panel does not retrieve or analyze results',
  );
  expect(userPrompt).toContain('month (default)');
  expect(userPrompt).toContain('trends (default)');
  expect(report.configuration.initialRequest).toMatchObject({
    context: {
      chartDimensions: { columns: 30, rows: 18 },
      updateReasons: [{ type: 'user_intent', intent: intents[0] }],
    },
    instances: [
      { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
    ],
    layout: { type: 'tiling', tree: ['ID:weather-main'] },
  });
});

test('D35 flags, acknowledgement and model/endpoint drift stop before dispatch', async () => {
  const send = mock<ManualFetch>();
  for (const [flags, configuration] of [
    [['--live'], env],
    [args, {}],
    [args, { OPENAI_API_KEY: ' ' }],
    [args, { ...env, ENGINE_MODEL: 'other' }],
    [args, { ...env, OPENAI_BASE_URL: 'https://invalid.test' }],
    [args, { ...env, OPENAI_CUSTOM_HEADERS: 'custom' }],
    [['--confirm-capped-key'], env],
    [['--live', '--live'], env],
    [['--case', 'D35'], env],
    [['--grader'], env],
  ] as const)
    await expect(runD35(flags, configuration, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

test('D35 validates its adjudicated case contract before dispatch without reading scripted fixtures', async () => {
  const original = fs.readFileSync;
  const send = mock<ManualFetch>();
  for (const filename of ['three-vessel-addition']) {
    const read = spyOn(fs, 'readFileSync').mockImplementation(((
      file: unknown,
      ...rest: unknown[]
    ) => {
      const path = String(file);
      if (path.includes('/fixtures/'))
        throw new Error('Must not load scripted fixture');
      const content = Reflect.apply(original, fs, [file, ...rest]);
      if (path.endsWith(`/${filename}.json`)) {
        const value = JSON.parse(String(content));
        value.lineage[0].pointer = '/items/31';
        return JSON.stringify(value);
      }
      return content;
    }) as typeof fs.readFileSync);
    try {
      await expect(runD35(args, env, send)).rejects.toThrow(
        'case contract changed',
      );
    } finally {
      read.mockRestore();
    }
  }
  expect(send).not.toHaveBeenCalled();
});

test('D35 synthetic Engine/planner requests carry actual prior replies and exact ordered role/content', async () => {
  const { report, turns, requests, bodies } = await evidence();
  expect(report.generationDispatches).toBe(3);
  expect(report.result).toMatchObject({
    execution: 'completed',
    completeness: 'complete',
    evaluation: 'pass',
    failures: [],
  });
  expect(requests).toHaveLength(3);
  expect(new Set(turns.map(({ requestId }) => requestId)).size).toBe(3);
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
    expect(body.text).toMatchObject({
      format: { type: 'json_schema', strict: true },
    });
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
    expect<unknown>(turns[index].response.executionPlan).toEqual(
      replies()[index].executionPlan,
    );
    expect(turns[index].request.layout).toEqual(
      index === 0
        ? report.configuration.initialRequest.layout
        : turns[index - 1].response.layout,
    );
    prior.push(
      { role: 'user', content: intents[index] },
      { role: 'assistant', content: turns[index].response.userMessage },
    );
  }
  expect(report.semanticReview.status).toBe('pending-human-review');
  for (const caveat of [
    'COMPLETE only for the user-adjudicated current contract',
    'one fresh post-fix current-Engine sample passed',
    'prior failed reports remain preserved',
    "does not predetermine this run's verdict or semantic review",
    'no user semantic acceptance is implied',
    'Weather-only start was user-adjudicated',
    'legacy TASK_DEFINITIONS',
    'No source scorer/runtime equivalence',
    'clinical data/trend fulfillment',
    'client/handler execution',
    'reliability claim',
    'Three exact source prompts',
  ])
    expect(report.limitation).toContain(caveat);
  expect(report.limitation).not.toContain('PARTIAL');
  expect(report.limitation).not.toContain('pending a passing');
  expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
});

test('D35 rejects missing/reordered turns and wrong identities, variants and required Actions', async () => {
  const { report, turns } = await evidence();
  const score = (value: D35Turn[]) =>
    scoreD35Turns(value, report.configuration.initialRequest);
  for (const changed of [
    turns.slice(1),
    [...turns, turns[2]],
    [turns[1], turns[0], turns[2]],
  ])
    expect(score(changed).outcome).toBe('fail');
  for (const index of [1, 2]) {
    for (const plan of [
      [],
      [{ instanceId: InstanceId('foreign'), action: ActionName('showWeek') }],
      [
        {
          instanceId: InstanceId('labs-main'),
          action: ActionName('selectMarker'),
          params: { markerSlug: 'hemoglobin' },
        },
      ],
    ]) {
      const changed = structuredClone(turns);
      changed[index].response = {
        ...changed[index].response,
        executionPlan: plan,
      };
      expect(score(changed).outcome).toBe('fail');
    }
  }
  for (let index = 0; index < 3; index++)
    for (const target of [0, 1, 2]) {
      const changed = structuredClone(turns);
      const layout = changed[index].response.layout;
      if (layout.type !== 'tiling') throw new Error('Expected tiling');
      changed[index].response = {
        ...changed[index].response,
        layout: {
          ...layout,
          instances: layout.instances.map((item, i) =>
            i === target ? { ...item, variant: VariantName('other') } : item,
          ),
        },
      };
      expect(score(changed).outcome).toBe('fail');
    }
});

test('D35 exact history, request carry-forward and incoming catalog checks are independent of output', async () => {
  const { report, turns } = await evidence();
  for (const mutate of [
    (value: MutableTurn[]) => {
      value[1].history = [];
    },
    (value: MutableTurn[]) => {
      value[2].history = [...value[2].history].reverse();
    },
    (value: MutableTurn[]) => {
      value[1].request = structuredClone(value[0].request);
    },
    (value: MutableTurn[]) => {
      value[1].request.vessels[0].variants[VariantName('current')].actions = [];
    },
    (value: MutableTurn[]) => {
      value[0].index = 2;
    },
  ]) {
    const changed = structuredClone(turns);
    mutate(changed);
    expect(
      scoreD35Turns(changed, report.configuration.initialRequest).outcome,
    ).toBe('fail');
  }
});

test('D35 permits extra valid non-transition Actions but not Labs mutation after addition; prose/effects are unscored', async () => {
  const { report, turns } = await evidence();
  for (const turn of turns)
    turn.response = {
      ...turn.response,
      executionPlan: [
        ...turn.response.executionPlan,
        {
          instanceId: InstanceId('weather-main'),
          action: ActionName('setLocation'),
          params: { unscored: true },
        },
      ],
    };
  expect(
    scoreD35Turns(turns, report.configuration.initialRequest).outcome,
  ).toBe('pass');
  turns[2].response = {
    ...turns[2].response,
    userMessage: 'Unverified clinical data claim.',
  };
  expect(
    scoreD35Turns(turns, report.configuration.initialRequest).outcome,
  ).toBe('pass');
  expect(report.semanticReview.status).toBe('pending-human-review');
  expect(report.semanticReview.criteria.join(' ')).toContain(
    'no invented lab results',
  );
  turns[2].response = {
    ...turns[2].response,
    executionPlan: [
      ...turns[2].response.executionPlan,
      {
        instanceId: InstanceId('labs-main'),
        action: ActionName('selectMarker'),
        params: { markerSlug: 'hemoglobin' },
      },
    ],
  };
  expect(
    scoreD35Turns(turns, report.configuration.initialRequest).outcome,
  ).toBe('fail');
});

test('D35 stops on each failed/incomplete dispatch without retries or leaking provider errors', async () => {
  for (const failAt of [0, 1, 2]) {
    for (const failure of [
      'http',
      'throw',
      'incomplete',
      'malformed',
    ] as const) {
      let calls = 0;
      const send: ManualFetch = async () => {
        const index = calls++;
        if (index !== failAt) return sse(replies()[index]);
        if (failure === 'throw') throw new Error(env.OPENAI_API_KEY);
        if (failure === 'http')
          return new Response(env.OPENAI_API_KEY, { status: 429 });
        if (failure === 'incomplete')
          return sse(replies()[index], 'incomplete');
        return sse({});
      };
      const report = await runD35(args, env, send);
      if (report.mode !== 'live')
        throw new Error('Expected synthetic live path');
      expect(calls).toBe(failAt + 1);
      expect(report.generationDispatches).toBe(failAt + 1);
      expect(report.result.completeness).toBe(failAt ? 'partial' : 'absent');
      expect(report.result.evaluation).toBe('unscored');
      expect(report.result.observation).toHaveLength(failAt);
      expect(report.semanticReview.status).toBe('unavailable');
      expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
    }
  }
});

test('D35 regression control for the observed clarification/no-addition failure still fails the unchanged predicate', async () => {
  const responses = replies();
  for (const index of [0, 1]) {
    responses[index].layout.instances = [responses[index].layout.instances[0]];
    responses[index].layout.tree = ['ID:weather-main'];
  }
  responses[0].userMessage = 'Synthetic clarification: which calendar view?';
  responses[2].executionPlan = [];
  responses[2].layout.instances = [
    responses[2].layout.instances[0],
    { instanceId: 'calendar-week', vesselId: 'calendar', variant: 'week' },
  ];
  responses[2].layout.tree = ['V', 'ID:weather-main', 'ID:calendar-week'];
  const transport = scripted(responses);
  const report = await runD35(args, env, transport.send);
  if (report.mode !== 'live') throw new Error('Expected synthetic live path');
  expect(report.result).toMatchObject({
    execution: 'completed',
    completeness: 'complete',
    evaluation: 'fail',
  });
  expect(report.generationDispatches).toBe(3);
  expect(transport.requests).toHaveLength(3);
  expect(report.result.failures).toEqual([
    'Turn 0 changed required membership, identity or Variant',
    'Turn 1 changed required membership, identity or Variant',
    'Turn 2 changed required membership, identity or Variant',
    'Turn 2 missing required navigation Action',
  ]);
  expect(report.semanticReview.status).toBe('pending-human-review');
});

test('D35 wrong shipped targets/creation and missing navigation cannot manufacture a passing result', async () => {
  for (const index of [0, 1, 2]) {
    const responses = replies();
    if (index === 0) responses[0].layout.instances.pop();
    else responses[index].executionPlan = [];
    const transport = scripted(responses);
    const report = await runD35(args, env, transport.send);
    if (report.mode !== 'live') throw new Error('Expected synthetic live path');
    expect(report.result.evaluation).not.toBe('pass');
  }
});
