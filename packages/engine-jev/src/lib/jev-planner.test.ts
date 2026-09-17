import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createEngine,
  createInMemoryStore,
  type Logger,
  type PlannerInvocation,
} from '@maelstrom-co/engine';
import {
  ChartRequestMessage,
  ChartRequestSchema,
  isErr,
  isOk,
  MessageId,
  SessionId,
  VariantName,
} from '@maelstrom-co/protocol';

import { createJevPlanner } from './jev-planner.js';

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
const model = 'jev-test';
const key = 'typesafe-secret-value';

type Payload = {
  readonly model: string;
  readonly state: Record<string, unknown>;
  readonly questions: Record<
    string,
    { readonly criteria: Record<string, string> }
  >;
};
type StageSelections = (payload: Payload) => Readonly<Record<string, string>>;

function makeRequest(intent: string, overrides: Record<string, unknown> = {}) {
  const vessels = [
    {
      id: 'calendar',
      name: 'Calendar',
      description: 'Shows calendar items',
      defaultVariant: 'month',
      variants: {
        month: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [],
        },
      },
    },
    {
      id: 'weather',
      name: 'Weather',
      description: 'Shows weather',
      defaultVariant: 'current',
      variants: {
        current: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [
            {
              name: 'setLocation',
              description: 'Sets a named location',
              parameters: [
                {
                  name: 'location',
                  type: 'string',
                  description: 'Location name',
                },
              ],
            },
            {
              name: 'showWeekly',
              description: 'Shows weekly forecast',
              transitionsTo: 'weekly',
            },
          ],
        },
        weekly: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [
            {
              name: 'showCurrent',
              description: 'Shows current forecast',
              transitionsTo: 'current',
            },
          ],
        },
      },
    },
    {
      id: 'tasks',
      name: 'Tasks',
      description: 'Shows tasks',
      defaultVariant: 'list',
      variants: {
        list: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [
            {
              name: 'addTask',
              description: 'Adds a task',
              parameters: [
                { name: 'title', type: 'string', description: 'Task title' },
              ],
            },
            {
              name: 'checkTask',
              description: 'Completes an existing task',
              parameters: [
                {
                  name: 'title',
                  type: 'string',
                  description: 'Existing task title',
                  enum: ['Buy milk', 'Send invoice'],
                },
              ],
            },
          ],
        },
      },
    },
    {
      id: 'map',
      name: 'Map',
      description: 'Shows routes',
      defaultVariant: 'default',
      variants: {
        default: {
          props: {},
          minSize: { width: 1, height: 1 },
          actions: [
            {
              name: 'showRoute',
              description: 'Shows a saved route',
              parameters: [
                {
                  name: 'destination',
                  type: 'string',
                  description: 'Saved destination',
                  enum: ['Studio Vortex HQ'],
                },
              ],
            },
          ],
        },
      },
    },
  ];
  const instances = [
    { instanceId: 'calendar-main', vesselId: 'calendar', variant: 'month' },
    { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
    { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
    { instanceId: 'map-main', vesselId: 'map', variant: 'default' },
  ];
  return ChartRequestSchema.parse({
    type: 'chart_request',
    context: {
      layoutMode: 'tiling',
      chartDimensions: { columns: 30, rows: 18 },
      updateReasons: [{ type: 'user_intent', intent }],
    },
    vessels,
    instances,
    layout: {
      type: 'tiling',
      tree: ['V:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
      instances,
    },
    ...overrides,
  });
}

function reply(payload: Payload, selections: Readonly<Record<string, string>>) {
  return {
    model,
    answers: Object.fromEntries(
      Object.entries(payload.questions).map(([id, question]) => {
        const choice = selections[id] ?? Object.keys(question.criteria)[0];
        return [
          id,
          {
            type: 'choice',
            choice,
            confidence: 1,
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map((option) => [
                option,
                option === choice ? 1 : 0,
              ]),
            ),
          },
        ];
      }),
    ),
    usage: { input_tokens: 7, output_tokens: 3 },
  };
}

function fetchScript(
  stages: readonly StageSelections[],
  seen: Payload[] = [],
): typeof fetch {
  let index = 0;
  return asFetch(async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    seen.push(payload);
    const select = stages[index++];
    if (select === undefined) throw new Error('unexpected Jev stage');
    return new Response(JSON.stringify(reply(payload, select(payload))), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function asFetch(
  handler: (input: string | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return handler as unknown as typeof fetch;
}

function actionsOf(response: ReturnType<typeof responseOf>) {
  return response.executionPlan.map(({ instanceId, action, params }) => ({
    instanceId: String(instanceId),
    action: String(action),
    ...(params === undefined ? {} : { params }),
  }));
}

function defaults(overrides: Record<string, string> = {}): StageSelections {
  return (payload) => {
    const selections: Record<string, string> = {
      scope: 'supported',
      arrangement: 'preserve',
      primary: 'none',
      actionCount: '0',
      ...overrides,
    };
    for (const id of Object.keys(payload.questions)) {
      if (id.startsWith('presence/')) selections[id] ??= 'unchanged';
      if (id.startsWith('create/')) selections[id] ??= '0';
    }
    return selections;
  };
}

async function run(
  request: ReturnType<typeof makeRequest>,
  stages: readonly StageSelections[],
  options: {
    readonly maxProviderCalls?: number;
    readonly store?: ReturnType<typeof createInMemoryStore>;
  } = {},
) {
  const seen: Payload[] = [];
  const engine = createEngine({
    planner: {
      primary: {
        implementation: createJevPlanner({
          apiKey: key,
          model,
          fetch: fetchScript(stages, seen),
        }),
        finalization: 'strict',
        maxRepairAttempts: 0,
      },
      operation: {
        timeoutMs: null,
        maxProviderCalls: options.maxProviderCalls ?? 3,
      },
    },
    ...(options.store ? { history: { store: options.store } } : {}),
    logger,
  });
  const result = await engine.handle(
    ChartRequestMessage({
      sessionId: SessionId('jev-test'),
      id: MessageId(`jev-${Math.random()}`),
      request,
    }),
  );
  return { result, seen };
}

function responseOf(result: Awaited<ReturnType<typeof run>>['result']) {
  expect(isOk(result)).toBe(true);
  if (!isOk(result) || result.value.type !== 'chart_response')
    throw new Error('expected chart response');
  return result.value.response;
}

describe('createJevPlanner', () => {
  function boundaryEngine(
    transport: typeof fetch,
    options: {
      confidence?: number;
      timeoutMs?: number;
      fallback?: boolean;
    } = {},
  ) {
    let fallbackCalls = 0;
    const engine = createEngine({
      planner: {
        primary: {
          implementation: createJevPlanner({
            apiKey: key,
            model,
            fetch: transport,
            ...(options.confidence === undefined
              ? {}
              : { confidence: { minimum: options.confidence } }),
          }),
          finalization: 'strict',
          maxRepairAttempts: 0,
        },
        ...(options.fallback
          ? {
              fallback: {
                implementation: {
                  id: 'fallback',
                  supportedLayoutModes: ['tiling'] as const,
                  async invoke({ input, context }: PlannerInvocation) {
                    fallbackCalls++;
                    const claim = context.calls.claim({
                      plannerId: 'fallback',
                      stage: 'initial',
                    });
                    if (!claim.ok)
                      return {
                        ok: false as const,
                        error: {
                          kind: 'budget_exhausted' as const,
                          message: 'test fallback budget exhausted',
                        },
                      };
                    return {
                      ok: true as const,
                      value: {
                        kind: 'candidate' as const,
                        candidate: {
                          layout: input.request.layout,
                          executionPlan: [],
                        },
                      },
                    };
                  },
                },
                finalization: 'strict' as const,
                maxRepairAttempts: 0,
                on: ['deferred'] as const,
              },
            }
          : {}),
        operation: {
          timeoutMs: options.timeoutMs ?? null,
          maxProviderCalls: options.fallback ? 2 : 3,
        },
      },
      logger,
    });
    return { engine, fallbackCalls: () => fallbackCalls };
  }

  function manyInstances(count: number) {
    const base = makeRequest('Arrange all calendars in one row.');
    const vessel = base.vessels[0];
    const instances = Array.from({ length: count }, (_, i) => ({
      instanceId: `calendar-${i}`,
      vesselId: 'calendar',
      variant: 'month',
    }));
    const tree = instances.flatMap((item, i) =>
      i < count - 1
        ? ['V', `ID:${item.instanceId}`]
        : [`ID:${item.instanceId}`],
    );
    return makeRequest('Arrange all calendars in one row.', {
      vessels: [vessel],
      instances,
      layout: { type: 'tiling', tree, instances },
    });
  }

  test('returns a policy deferral for unsupported layout templates and permits deferred fallback', async () => {
    const request = manyInstances(13);
    const direct = await createJevPlanner({
      apiKey: key,
      model,
      fetch: fetchScript([defaults({ arrangement: 'row' })]),
    }).invoke({
      input: {
        request,
        history: { structured: [], conversation: [] },
        actionEnums: [],
      },
      phase: { kind: 'initial' },
      context: {
        signal: new AbortController().signal,
        calls: { remaining: 3, claim: () => ({ ok: true, value: undefined }) },
      },
    });
    expect(direct).toMatchObject({
      ok: true,
      value: { kind: 'deferred', reason: 'policy' },
    });
    const outcome = await run(request, [defaults({ arrangement: 'row' })]);
    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok)
      expect(outcome.result.error).toMatchObject({
        _tag: 'PlanningDeferredError',
        reason: 'policy',
      });
    const { engine, fallbackCalls } = boundaryEngine(
      fetchScript([defaults({ arrangement: 'row' })]),
      { fallback: true },
    );
    expect(
      (
        await engine.handle(
          ChartRequestMessage({
            sessionId: SessionId('template-fallback'),
            request,
          }),
        )
      ).ok,
    ).toBe(true);
    expect(fallbackCalls()).toBe(1);
  });

  test('defers oversized primary choices before sending an invalid provider request', async () => {
    const outcome = await run(manyInstances(253), [defaults()]);
    expect(outcome.seen).toHaveLength(0);
    expect(outcome.result.ok).toBe(false);
    if (!outcome.result.ok)
      expect(outcome.result.error).toMatchObject({
        _tag: 'PlanningDeferredError',
        reason: 'policy',
      });
  });

  test('rejects consumed uncertain layout decisions before spending the fallback call budget', async () => {
    let calls = 0;
    const transport = asFetch(async (_input, init) => {
      calls++;
      const payload = JSON.parse(String(init?.body)) as Payload;
      const result = reply(payload, defaults({ actionCount: '1' })(payload));
      result.answers.scope.confidence = 0.1;
      return Response.json(result);
    });
    const { engine, fallbackCalls } = boundaryEngine(transport, {
      confidence: 0.5,
      fallback: true,
    });
    expect(
      (
        await engine.handle(
          ChartRequestMessage({
            sessionId: SessionId('uncertain'),
            request: makeRequest('Show weekly weather.'),
          }),
        )
      ).ok,
    ).toBe(true);
    expect(calls).toBe(1);
    expect(fallbackCalls()).toBe(1);
  });

  test('ignores low confidence in unused primary selection', async () => {
    const transport = asFetch(async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as Payload;
      const result = reply(payload, defaults()(payload));
      result.answers.primary.confidence = 0;
      return Response.json(result);
    });
    const { engine } = boundaryEngine(transport, { confidence: 0.5 });
    expect(
      (
        await engine.handle(
          ChartRequestMessage({
            sessionId: SessionId('unused'),
            request: makeRequest('Preserve layout.'),
          }),
        )
      ).ok,
    ).toBe(true);
  });

  test('aborts an active fetch at the finite operation deadline and never starts another stage', async () => {
    let calls = 0;
    let signal: AbortSignal | null | undefined;
    const transport = asFetch(async (_input, init) => {
      calls++;
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error(key)), {
          once: true,
        }),
      );
    });
    const { engine } = boundaryEngine(transport, { timeoutMs: 10 });
    const outcome = await engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('deadline'),
        request: makeRequest('Show weekly weather.'),
      }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok)
      expect(outcome.error).toMatchObject({
        _tag: 'TimeoutError',
        timeoutMs: 10,
      });
    expect(signal?.aborted).toBe(true);
    expect(calls).toBe(1);
  });

  test('normalizes a stateful object enum once and copies its selected normalized value', async () => {
    const request = makeRequest('Select the saved task.');
    let conversions = 0;
    const definition = request.vessels
      .find((v) => v.id === 'tasks')
      ?.variants[VariantName('list')].actions.find(
        (a) => a.name === 'checkTask',
      );
    if (!definition) throw new Error('missing test action');
    definition.parameters = [
      {
        name: 'title',
        type: 'object',
        description: 'Saved record',
        enum: [
          {
            toJSON() {
              conversions++;
              return { id: conversions, label: 'saved' };
            },
          },
        ],
      },
    ];
    const outcome = await run(request, [
      defaults({ actionCount: '1' }),
      () => ({ 'action/0': 'tasks-main/checkTask' }),
      () => ({ 'param/0/title': 'v0' }),
    ]);
    expect(actionsOf(responseOf(outcome.result))).toEqual([
      {
        instanceId: 'tasks-main',
        action: 'checkTask',
        params: { title: { id: 1, label: 'saved' } },
      },
    ]);
    expect(conversions).toBe(1);
    expect(outcome.seen[2].questions['param/0/title'].criteria.v0).toBe(
      '{"id":1,"label":"saved"}',
    );
  });

  test.each([
    [
      'model',
      (r: ReturnType<typeof reply>) => {
        r.model = 'another-model';
      },
    ],
    [
      'negative usage',
      (r: ReturnType<typeof reply>) => {
        r.usage.input_tokens = -1;
      },
    ],
    [
      'fractional usage',
      (r: ReturnType<typeof reply>) => {
        r.usage.output_tokens = 0.5;
      },
    ],
    [
      'missing answer',
      (r: ReturnType<typeof reply>) => {
        delete r.answers.scope;
      },
    ],
    [
      'extra answer',
      (r: ReturnType<typeof reply>) => {
        r.answers.extra = r.answers.scope;
      },
    ],
    [
      'missing probability',
      (r: ReturnType<typeof reply>) => {
        delete r.answers.scope.probabilities.ambiguous;
      },
    ],
    [
      'extra probability',
      (r: ReturnType<typeof reply>) => {
        r.answers.scope.probabilities.extra = 0;
      },
    ],
    [
      'negative probability',
      (r: ReturnType<typeof reply>) => {
        r.answers.scope.probabilities.ambiguous = -1;
      },
    ],
    [
      'nonfinite probability',
      (r: ReturnType<typeof reply>) => {
        r.answers.scope.probabilities.supported = Number.POSITIVE_INFINITY;
      },
    ],
    [
      'invalid confidence',
      (r: ReturnType<typeof reply>) => {
        r.answers.scope.confidence = 2;
      },
    ],
    [
      'invalid total',
      (r: ReturnType<typeof reply>) => {
        r.answers.scope.probabilities.supported = 0.5;
      },
    ],
  ] as const)('rejects malformed %s before later stages', async (_label, mutate) => {
    let calls = 0;
    const { engine } = boundaryEngine(
      asFetch(async (_input, init) => {
        calls++;
        const payload = JSON.parse(String(init?.body)) as Payload;
        const result = reply(payload, defaults({ actionCount: '1' })(payload));
        mutate(result);
        return Response.json(result);
      }),
    );
    const outcome = await engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('malformed'),
        request: makeRequest('Show weekly weather.'),
      }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok)
      expect(outcome.error._tag).toBe('InvalidProviderResponseError');
    expect(calls).toBe(1);
  });
  test('preserves, shows, hides, and deletes without actions', async () => {
    const scenarios = [
      ['preserve', {}, ['calendar-main', 'weather-main', 'tasks-main'], 4],
      [
        'show',
        { 'presence/map-main': 'show', arrangement: 'row' },
        ['calendar-main', 'weather-main', 'tasks-main', 'map-main'],
        4,
      ],
      [
        'hide',
        { 'presence/weather-main': 'hide' },
        ['calendar-main', 'tasks-main'],
        4,
      ],
      [
        'delete',
        { 'presence/weather-main': 'delete' },
        ['calendar-main', 'tasks-main'],
        3,
      ],
    ] as const;
    for (const [, selections, visible, retained] of scenarios) {
      const { result, seen } = await run(makeRequest('layout request'), [
        defaults(selections),
      ]);
      const response = responseOf(result);
      expect(response.executionPlan).toEqual([]);
      expect(response.layout.type).toBe('tiling');
      if (response.layout.type === 'tiling') {
        expect(
          response.layout.tree
            .map((node) => String(node))
            .filter((node) => node.startsWith('ID:')),
        ).toEqual(visible.map((id) => `ID:${id}`));
        expect(response.layout.instances).toHaveLength(retained);
      }
      expect(seen).toHaveLength(1);
    }
  });

  test('creates code-owned instances and targets only retained candidates', async () => {
    const { result, seen } = await run(
      makeRequest('Compare "Tokyo" and "Paris".'),
      [
        defaults({
          actionCount: '2',
          arrangement: 'row',
          primary: 'weather-main',
          'create/weather': '1',
          'presence/calendar-main': 'hide',
          'presence/tasks-main': 'hide',
        }),
        () => ({
          'action/0': 'weather-main/setLocation',
          'action/1': 'weather-jev-1/setLocation',
        }),
        (payload) => ({
          'param/0/location':
            Object.entries(
              payload.questions['param/0/location']?.criteria ?? {},
            ).find(([, value]) => value === '"Tokyo"')?.[0] ?? 'missing',
          'param/1/location':
            Object.entries(
              payload.questions['param/1/location']?.criteria ?? {},
            ).find(([, value]) => value === '"Paris"')?.[0] ?? 'missing',
        }),
      ],
    );
    const response = responseOf(result);
    expect(actionsOf(response)).toEqual([
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        params: { location: 'Tokyo' },
      },
      {
        instanceId: 'weather-jev-1',
        action: 'setLocation',
        params: { location: 'Paris' },
      },
    ]);
    expect(seen).toHaveLength(3);
    const actionState = seen[1]?.state.pendingInstances as {
      instanceId: string;
    }[];
    expect(actionState.map((instance) => instance.instanceId)).toContain(
      'weather-jev-1',
    );
    expect(actionState.map((instance) => instance.instanceId)).not.toContain(
      'weather-jev-2',
    );
    expect(
      Object.keys(seen[1]?.questions['action/0']?.criteria ?? {}),
    ).not.toContain('weather-jev-2/setLocation');
  });

  test('uses normalized runtime enum values and keeps ordered variant transitions', async () => {
    const enumCase = await run(makeRequest('Mark Buy milk complete.'), [
      defaults({ actionCount: '1' }),
      () => ({ 'action/0': 'tasks-main/checkTask' }),
      (payload) => ({
        'param/0/title':
          Object.entries(
            payload.questions['param/0/title']?.criteria ?? {},
          ).find(([, value]) => value === '"Buy milk"')?.[0] ?? 'missing',
      }),
    ]);
    expect(actionsOf(responseOf(enumCase.result))).toEqual([
      {
        instanceId: 'tasks-main',
        action: 'checkTask',
        params: { title: 'Buy milk' },
      },
    ]);
    expect(
      Object.values(
        enumCase.seen[2]?.questions['param/0/title']?.criteria ?? {},
      ),
    ).toContain('"Buy milk"');

    const declaredEnumCase = await run(makeRequest('Route to headquarters.'), [
      defaults({ actionCount: '1' }),
      () => ({ 'action/0': 'map-main/showRoute' }),
      (payload) => ({
        'param/0/destination':
          Object.entries(
            payload.questions['param/0/destination']?.criteria ?? {},
          ).find(([, value]) => value === '"Studio Vortex HQ"')?.[0] ??
          'missing',
      }),
    ]);
    expect(actionsOf(responseOf(declaredEnumCase.result))).toEqual([
      {
        instanceId: 'map-main',
        action: 'showRoute',
        params: { destination: 'Studio Vortex HQ' },
      },
    ]);

    const transitionCase = await run(
      makeRequest('Show weekly then current weather.'),
      [
        defaults({ actionCount: '2' }),
        () => ({
          'action/0': 'weather-main/showWeekly',
          'action/1': 'weather-main/showCurrent',
        }),
      ],
    );
    expect(actionsOf(responseOf(transitionCase.result))).toEqual([
      { instanceId: 'weather-main', action: 'showWeekly' },
      { instanceId: 'weather-main', action: 'showCurrent' },
    ]);
    expect(transitionCase.seen).toHaveLength(2);
  });

  test('supplies accepted structured history to a follow-up without treating it as execution proof', async () => {
    const store = createInMemoryStore();
    const first = await run(makeRequest('Keep this board.'), [defaults()], {
      store,
    });
    responseOf(first.result);
    const second = await run(
      makeRequest('Now show weekly weather.'),
      [
        defaults({ actionCount: '1' }),
        () => ({ 'action/0': 'weather-main/showWeekly' }),
      ],
      { store },
    );
    expect(actionsOf(responseOf(second.result))).toEqual([
      { instanceId: 'weather-main', action: 'showWeekly' },
    ]);
    const history = second.seen[0]?.state.history as { kind: string }[];
    expect(history).toHaveLength(1);
    expect(history[0]?.kind).toBe('turn');
  });

  test('keeps resize deterministic and defers grid without network traffic', async () => {
    const resize = makeRequest('', {
      context: {
        layoutMode: 'tiling',
        chartDimensions: { columns: 8, rows: 30 },
        updateReasons: [
          {
            type: 'chart_resize',
            previous: { columns: 30, rows: 18 },
            current: { columns: 8, rows: 30 },
          },
        ],
      },
    });
    const deterministic = await run(resize, []);
    expect(responseOf(deterministic.result).executionPlan).toEqual([]);
    expect(deterministic.seen).toEqual([]);

    const tiling = makeRequest('grid');
    const grid = ChartRequestSchema.parse({
      ...tiling,
      context: { ...tiling.context, layoutMode: 'grid' },
      layout: {
        type: 'grid',
        positions: [
          {
            instanceId: 'calendar-main',
            position: { row: 0, column: 0 },
            size: { width: 2, height: 2 },
          },
        ],
      },
    });
    const unsupported = await run(grid, []);
    expect(isErr(unsupported.result)).toBe(true);
    expect(unsupported.seen).toEqual([]);
  });

  test('defers ambiguity, extraction and implementation limits without partial plans', async () => {
    const ambiguous = await run(makeRequest('Delete that one.'), [
      defaults({ scope: 'ambiguous' }),
    ]);
    expect(isErr(ambiguous.result)).toBe(true);
    expect(ambiguous.seen).toHaveLength(1);

    const missing = await run(makeRequest('Set weather to Tokyo.'), [
      defaults({ actionCount: '1' }),
      () => ({ 'action/0': 'weather-main/setLocation' }),
    ]);
    expect(isErr(missing.result)).toBe(true);
    expect(missing.seen).toHaveLength(2);

    const unsupported = await run(makeRequest('Write three tasks.'), [
      defaults({ scope: 'unsupported' }),
    ]);
    expect(isErr(unsupported.result)).toBe(true);
    expect(unsupported.seen).toHaveLength(1);

    const twoNew = await run(makeRequest('Open two more weather panels.'), [
      defaults({ 'create/weather': '2', arrangement: 'row' }),
    ]);
    const twoNewLayout = responseOf(twoNew.result).layout;
    expect(twoNewLayout.type).toBe('tiling');
    if (twoNewLayout.type === 'tiling') {
      const instanceIds = twoNewLayout.instances.map((instance) =>
        String(instance.instanceId),
      );
      expect(instanceIds).toContain('weather-jev-1');
      expect(instanceIds).toContain('weather-jev-2');
    }

    const overflowInstances = await run(
      makeRequest('Open many weather panels.'),
      [defaults({ 'create/weather': 'overflow' })],
    );
    expect(isErr(overflowInstances.result)).toBe(true);
    expect(overflowInstances.seen).toHaveLength(1);

    const extractionLimit = await run(
      makeRequest(
        Array.from({ length: 254 }, (_, index) => `"city-${index}"`).join(' '),
      ),
      [
        defaults({ actionCount: '1' }),
        () => ({ 'action/0': 'weather-main/setLocation' }),
      ],
    );
    expect(isErr(extractionLimit.result)).toBe(true);
    expect(extractionLimit.seen).toHaveLength(2);
  });

  test('rejects malformed metadata and distributions before a plan reaches finalization', async () => {
    const invalidFetch = asFetch(async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as Payload;
      const invalid = reply(payload, defaults()(payload));
      const scope = invalid.answers.scope;
      if (scope === undefined) throw new Error('scope fixture missing');
      scope.probabilities.supported = 0;
      scope.probabilities.unsupported = 1;
      return new Response(JSON.stringify(invalid));
    });
    const engine = createEngine({
      planner: {
        primary: {
          implementation: createJevPlanner({
            apiKey: key,
            model,
            fetch: invalidFetch,
          }),
          finalization: 'strict',
          maxRepairAttempts: 0,
        },
        operation: { timeoutMs: null, maxProviderCalls: 3 },
      },
      logger,
    });
    const result = await engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('invalid'),
        id: MessageId('invalid'),
        request: makeRequest('keep'),
      }),
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result))
      expect(result.error._tag).toBe('InvalidProviderResponseError');
  });

  test('does not continue after budget exhaustion or cancellation, and redacts provider failures', async () => {
    const exhausted = await run(
      makeRequest('Show weekly weather.'),
      [
        defaults({ actionCount: '1' }),
        () => ({ 'action/0': 'weather-main/showWeekly' }),
      ],
      { maxProviderCalls: 1 },
    );
    expect(isErr(exhausted.result)).toBe(true);
    if (isErr(exhausted.result))
      expect(exhausted.result.error._tag).toBe('PlanningBudgetExceededError');
    expect(exhausted.seen).toHaveLength(1);

    let calls = 0;
    let started: (() => void) | undefined;
    const blockingFetch = asFetch(async (_input, init) => {
      calls += 1;
      started?.();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error(key)), {
          once: true,
        });
      });
    });
    const engine = createEngine({
      planner: {
        primary: {
          implementation: createJevPlanner({
            apiKey: key,
            model,
            fetch: blockingFetch,
          }),
          finalization: 'strict',
          maxRepairAttempts: 0,
        },
        operation: { timeoutMs: null, maxProviderCalls: 3 },
      },
      logger,
    });
    const controller = new AbortController();
    const began = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = engine.handle(
      ChartRequestMessage({
        sessionId: SessionId('cancel'),
        id: MessageId('cancel'),
        request: makeRequest('keep'),
      }),
      controller.signal,
    );
    await began;
    controller.abort('stop');
    const cancelled = await pending;
    expect(isErr(cancelled)).toBe(true);
    if (isErr(cancelled))
      expect(cancelled.error._tag).toBe('CancellationError');
    expect(calls).toBe(1);

    const secretFetch = asFetch(
      async () => new Response(`provider body ${key}`, { status: 500 }),
    );
    const secretEngine = createEngine({
      planner: {
        primary: {
          implementation: createJevPlanner({
            apiKey: key,
            model,
            fetch: secretFetch,
          }),
          finalization: 'strict',
          maxRepairAttempts: 0,
        },
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
      logger,
    });
    const secretResult = await secretEngine.handle(
      ChartRequestMessage({
        sessionId: SessionId('secret'),
        id: MessageId('secret'),
        request: makeRequest('keep'),
      }),
    );
    expect(isErr(secretResult)).toBe(true);
    if (isErr(secretResult))
      expect(JSON.stringify(secretResult.error)).not.toContain(key);

    const echoedErrorFetch = asFetch(async () => {
      throw new Error(`transport echoed ${key}`);
    });
    const echoedErrorEngine = createEngine({
      planner: {
        primary: {
          implementation: createJevPlanner({
            apiKey: key,
            model,
            fetch: echoedErrorFetch,
          }),
          finalization: 'strict',
          maxRepairAttempts: 0,
        },
        operation: { timeoutMs: null, maxProviderCalls: 1 },
      },
      logger,
    });
    const echoedErrorResult = await echoedErrorEngine.handle(
      ChartRequestMessage({
        sessionId: SessionId('echoed-error'),
        id: MessageId('echoed-error'),
        request: makeRequest('keep'),
      }),
    );
    expect(isErr(echoedErrorResult)).toBe(true);
    if (isErr(echoedErrorResult))
      expect(JSON.stringify(echoedErrorResult.error)).not.toContain(key);
  });

  test('has no browser package dependency or forbidden runtime import', async () => {
    const manifest = await Bun.file(
      join(import.meta.dir, '../../package.json'),
    ).json();
    expect(Object.keys(manifest.dependencies)).toEqual([
      '@maelstrom-co/engine',
      '@maelstrom-co/protocol',
    ]);
    const source = await readFile(
      join(import.meta.dir, 'jev-planner.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/@maelstrom-co\/(client|react|realtime)/);
  });
});
