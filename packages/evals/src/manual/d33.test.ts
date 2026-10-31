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
import { type D33Turn, runD33, scoreD33Turns } from './d33.js';
import type { ManualFetch } from './transport.js';

type MutableTurn = { -readonly [K in keyof D33Turn]: D33Turn[K] };

const env = { OPENAI_API_KEY: 'synthetic-d33-test-key' };
const args = ['--live', '--confirm-capped-key'];
const intents = [
  'Show me the list of my lab results.',
  'Go back to the trends chart.',
  "What's the trend for hemoglobin?",
];
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
  const deny = () => {
    throw new Error('No network in D33 tests');
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
  return ['list', 'trends', 'trends'].map((variant, index) => ({
    userMessage:
      'Synthetic marker navigation only. No lab results or trend data available.',
    rationale: 'Synthetic output, not a model result',
    executionPlan: [
      {
        instanceId: 'labs-main',
        action: ['showList', 'showTrends', 'selectMarker'][index],
        ...(index === 2
          ? { paramsJson: JSON.stringify({ markerSlug: 'hemoglobin' }) }
          : {}),
      },
    ],
    layout: {
      type: 'tiling',
      tree: ['ID:labs-main'],
      instances: [{ instanceId: 'labs-main', vesselId: 'labs', variant }],
    },
  }));
}
function sse(value: unknown, status = 'completed') {
  const event = {
    type: status === 'completed' ? 'response.completed' : 'response.incomplete',
    response: {
      id: 'synthetic-d33-response',
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
  const report = await runD33(args, env, transport.send);
  if (report.mode !== 'live' || !report.result.observation)
    throw new Error('Missing synthetic evidence');
  expect(report.result.evaluation).toBe('pass');
  return {
    report,
    turns: structuredClone(report.result.observation) as MutableTurn[],
    ...transport,
  };
}

test('D33 dry-run reads the two source prompts plus existing synthetic third prompt and actual no-data catalog without credentials', async () => {
  const send = mock<ManualFetch>();
  const report = await runD33(
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
    sample: 'D33',
    model: 'gpt-6-luna',
    prompts: intents,
    syntheticTurnIndices: [2],
    engineRetries: 0,
    sdkRetries: 0,
    maxGenerationDispatches: 3,
    source: [{ pointer: '/items/32' }],
  });
  expect(report.configuration.systemPrompt).toBe(
    buildSystemPrompt('tiling', {
      system: { rules: { append: SYSTEM_RULES } },
    }),
  );
  for (const intent of intents)
    expect(report.configuration.systemPrompt).not.toContain(intent);
  const labs: { labsVessel: unknown } = await import(
    new URL(
      '../../../../apps/demo/src/vessels/labs.vessel.def.ts',
      import.meta.url,
    ).href
  );
  expect(report.configuration.initialRequest.vessels).toEqual([
    VesselSchema.parse(labs.labsVessel),
  ]);
  expect(report.configuration.initialRequest).toMatchObject({
    context: {
      chartDimensions: { columns: 30, rows: 18 },
      updateReasons: [{ type: 'user_intent', intent: intents[0] }],
    },
    instances: [
      { instanceId: 'labs-main', vesselId: 'labs', variant: 'trends' },
    ],
    layout: { type: 'tiling', tree: ['ID:labs-main'] },
  });
});

test('D33 flags, acknowledgement and model/endpoint drift stop before dispatch', async () => {
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
    [['--case', 'D33'], env],
    [['--grader'], env],
  ] as const)
    await expect(runD33(flags, configuration, send)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

test('D33 validates both preserved case contracts before dispatch without reading scripted fixtures', async () => {
  const original = fs.readFileSync;
  const send = mock<ManualFetch>();
  for (const filename of [
    'labs-state-reset-subset',
    'labs-state-reset-synthetic',
  ]) {
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
      await expect(runD33(args, env, send)).rejects.toThrow(
        'case contract changed',
      );
    } finally {
      read.mockRestore();
    }
  }
  expect(send).not.toHaveBeenCalled();
});

test('D33 synthetic Engine/planner requests carry actual prior replies and exact ordered role/content', async () => {
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
    expect<unknown>(turns[index].response.executionPlan).toEqual([
      {
        instanceId: 'labs-main',
        action: ['showList', 'showTrends', 'selectMarker'][index],
        ...(index === 2 ? { params: { markerSlug: 'hemoglobin' } } : {}),
      },
    ]);
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
  expect(report.limitation).toContain('COMPLETE');
  expect(report.limitation).toContain('no client/handler execution');
  expect(report.limitation).toContain('synthetic third prompt');
  expect(JSON.stringify(report)).not.toContain(env.OPENAI_API_KEY);
});

test('D33 scorer rejects missing/extra/reordered turns, plans, targets, variants and changed Chart identity', async () => {
  const { report, turns } = await evidence();
  const score = (changed: D33Turn[]) =>
    scoreD33Turns(changed, report.configuration.initialRequest);
  expect(score(turns.slice(0, 2)).outcome).toBe('fail');
  expect(score([...turns, turns[2]]).outcome).toBe('fail');
  expect(score([turns[1], turns[0], turns[2]]).outcome).toBe('fail');
  for (let index = 0; index < 3; index++) {
    for (const mutate of [
      (turn: MutableTurn) => {
        turn.response = { ...turn.response, executionPlan: [] };
      },
      (turn: MutableTurn) => {
        turn.response = {
          ...turn.response,
          executionPlan: [
            ...turn.response.executionPlan,
            turn.response.executionPlan[0],
          ],
        };
      },
      (turn: MutableTurn) => {
        turn.response = {
          ...turn.response,
          executionPlan: [
            {
              ...turn.response.executionPlan[0],
              instanceId: InstanceId('other'),
            },
          ],
        };
      },
      (turn: MutableTurn) => {
        turn.response = {
          ...turn.response,
          executionPlan: [
            { ...turn.response.executionPlan[0], action: ActionName('other') },
          ],
        };
      },
      (turn: MutableTurn) => {
        if (turn.response.layout.type === 'tiling')
          turn.response = {
            ...turn.response,
            layout: {
              ...turn.response.layout,
              instances: [
                {
                  ...turn.response.layout.instances[0],
                  variant: VariantName('other'),
                },
              ],
            },
          };
      },
      (turn: MutableTurn) => {
        if (turn.response.layout.type === 'tiling')
          turn.response = {
            ...turn.response,
            layout: {
              ...turn.response.layout,
              instances: [
                {
                  ...turn.response.layout.instances[0],
                  instanceId: InstanceId('other'),
                },
              ],
            },
          };
      },
      (turn: MutableTurn) => {
        if (turn.response.layout.type === 'tiling')
          turn.response = {
            ...turn.response,
            layout: { ...turn.response.layout, tree: [] },
          };
      },
    ]) {
      const changed = structuredClone(turns);
      mutate(changed[index]);
      expect(score(changed).outcome).toBe('fail');
    }
  }
});

test('D33 final selection is required and exact, not the separate optional-enum source predicate', async () => {
  const { report, turns } = await evidence();
  for (const params of [
    undefined,
    {},
    { markerSlug: 'platelets' },
    { markerSlug: 'glucose' },
    { markerSlug: 'unknown' },
    { markerSlug: 5 },
    { markerSlug: 'hemoglobin', extra: true },
  ]) {
    const changed = structuredClone(turns);
    changed[2].response = {
      ...changed[2].response,
      executionPlan: [{ ...changed[2].response.executionPlan[0], params }],
    };
    expect(
      scoreD33Turns(changed, report.configuration.initialRequest).outcome,
    ).toBe('fail');
  }
});

test('D33 detects history/order/carry-forward and incoming-action availability mismatches', async () => {
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
      value[1].request.vessels[0].variants[VariantName('list')].actions = [];
    },
    (value: MutableTurn[]) => {
      value[2].request = {
        ...value[2].request,
        instances: [
          { ...value[2].request.instances[0], variant: VariantName('list') },
        ],
      };
    },
    (value: MutableTurn[]) => {
      value[0].index = 2;
    },
  ]) {
    const changed = structuredClone(turns);
    mutate(changed);
    expect(
      scoreD33Turns(changed, report.configuration.initialRequest).outcome,
    ).toBe('fail');
  }
});

test('D33 structural success cannot certify prose, clinical trend fulfillment or handler effects', async () => {
  const { report, turns } = await evidence();
  turns[2].response = {
    ...turns[2].response,
    userMessage: 'Your hemoglobin is normal.',
  };
  expect(
    scoreD33Turns(turns, report.configuration.initialRequest).outcome,
  ).toBe('pass');
  expect(report.semanticReview.criteria.join(' ')).toContain('no measurements');
  expect(report.limitation).toContain('clinical trend fulfillment');
});

test('D33 stops on each failed/incomplete dispatch without retries or leaking provider errors', async () => {
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
      const report = await runD33(args, env, send);
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

test('D33 malformed or invalid marker candidates cannot manufacture a passing shipped response', async () => {
  const responses = replies();
  responses[2].executionPlan[0].paramsJson = JSON.stringify({
    markerSlug: 'not-a-marker',
  });
  const transport = scripted(responses);
  const report = await runD33(args, env, transport.send);
  if (report.mode !== 'live') throw new Error('Expected synthetic live path');
  expect(report.generationDispatches).toBe(3);
  expect(report.result.evaluation).not.toBe('pass');
});
