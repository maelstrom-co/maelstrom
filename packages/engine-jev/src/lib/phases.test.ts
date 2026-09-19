import { describe, expect, test } from 'bun:test';
import { createEngine, createInMemoryStore } from '@maelstrom-co/engine';
import { ChartRequestMessage, SessionId } from '@maelstrom-co/protocol';
import { request } from '../../evaluation/fixtures.js';
import { createJevPlanner } from './jev-planner.js';

type Payload = {
  state: {
    previousActions?: readonly { params?: Record<string, unknown> }[];
    newInstanceSets?: Record<
      string,
      Record<string, readonly { instanceId: string; desiredVariant: string }[]>
    >;
    availableActions?: { key: string; instanceId: string; action: string }[];
  };
  questions: Record<string, { criteria: Record<string, string> }>;
};
type Script = {
  views?: Record<string, string>;
  layout?: string;
  actions?: {
    instanceId: string;
    action: string;
    params?: Record<string, unknown>;
  }[];
  budget?: number;
  inspect?: (payload: Payload) => void;
};
const logger = { debug() {}, info() {}, warn() {}, error() {} };

async function run(input: ReturnType<typeof request>, script: Script = {}) {
  const seen: Payload[] = [];
  const transport = (async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as Payload;
    seen.push(payload);
    script.inspect?.(payload);
    const answers = Object.fromEntries(
      Object.entries(payload.questions).map(([id, question]) => {
        let choice: string;
        if (id === 'scope') choice = 'supported';
        else if (id.startsWith('new/')) {
          const sets = payload.state.newInstanceSets?.[id.slice(4)] ?? {};
          const requested = Object.entries(script.views ?? {}).filter(
            ([instance, value]) =>
              instance.startsWith(`${id.slice(4)}-jev-`) &&
              value.startsWith('show/'),
          );
          choice =
            Object.entries(sets).find(
              ([, instances]) =>
                instances.length === requested.length &&
                instances.every((instance) =>
                  requested.some(
                    ([target, value]) =>
                      target === instance.instanceId &&
                      value === `show/${instance.desiredVariant}`,
                  ),
                ),
            )?.[0] ?? 'none';
        } else if (id.startsWith('view/'))
          choice =
            script.views?.[id.slice(5)] ??
            ('keep' in question.criteria ? 'keep' : 'absent');
        else if (id === 'layout')
          choice =
            script.layout ??
            ('preserve' in question.criteria
              ? 'preserve'
              : Object.keys(question.criteria)[0]);
        else if (id.startsWith('action/')) {
          const action = script.actions?.[Number(id.slice(7))];
          choice = action
            ? (payload.state.availableActions?.find(
                (option) =>
                  option.instanceId === action.instanceId &&
                  option.action === action.action,
              )?.key ?? 'unsupported')
            : 'done';
        } else {
          const [, index, parameter] = id.split('/');
          const value = script.actions?.[Number(index)]?.params?.[parameter];
          choice =
            Object.entries(question.criteria).find(
              ([key, description]) =>
                key.startsWith('v') && description === JSON.stringify(value),
            )?.[0] ?? 'missing';
        }
        return [
          id,
          {
            type: 'choice',
            choice,
            confidence: 1,
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map((key) => [
                key,
                key === choice ? 1 : 0,
              ]),
            ),
          },
        ];
      }),
    );
    return Response.json({
      model: 'jev-phases-test',
      answers,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  }) as typeof fetch;
  const store = createInMemoryStore();
  const engine = createEngine({
    logger,
    history: { store },
    planner: {
      primary: {
        implementation: createJevPlanner({
          apiKey: 'offline',
          model: 'jev-phases-test',
          fetch: transport,
        }),
        finalization: 'strict',
        maxRepairAttempts: 0,
      },
      operation: { timeoutMs: null, maxProviderCalls: script.budget ?? 11 },
    },
  });
  const result = await engine.handle(
    ChartRequestMessage({ sessionId: SessionId('phases'), request: input }),
  );
  return {
    result,
    seen,
    history: await engine.getHistory(SessionId('phases')),
  };
}

describe('dependent Jev planning phases', () => {
  test('asks whether work remains even when the selected view has no content actions', async () => {
    const outcome = await run(request('Show weekly weather for Tokyo'), {
      views: {
        'weather-main': 'show/weekly',
        'tasks-main': 'delete',
        'weather-hidden': 'delete',
      },
      actions: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Tokyo' },
        },
      ],
    });
    expect(outcome.seen.at(-1)?.questions['action/0'].criteria).toEqual({
      done: expect.any(String),
      unsupported: expect.any(String),
    });
    expect(outcome.result).toMatchObject({
      ok: false,
      error: { _tag: 'PlanningDeferredError', reason: 'policy' },
    });
    expect(outcome.history).toEqual({ ok: true, value: [] });
  });

  test('offers a full-Chart alternative when preserving one instance would retain empty space', async () => {
    const base = request('Make weather fill the chart');
    const outcome = await run(
      request('Make weather fill the chart', {
        layout: {
          type: 'tiling',
          tree: ['V', 'ID:weather-main', null],
          instances: base.instances,
        },
      }),
      { layout: 'single' },
    );
    expect(outcome.seen[1].questions.layout.criteria).toHaveProperty(
      'preserve',
    );
    expect(outcome.seen[1].questions.layout.criteria).toHaveProperty('single');
    expect(outcome.result).toMatchObject({
      ok: true,
      value: { response: { layout: { tree: ['ID:weather-main'] } } },
    });
  });
  test('selects an explicit pair as one coherent set with independent desired views', async () => {
    const base = request('Compare current and weekly weather');
    const tasks = base.instances.filter(
      (instance) => instance.vesselId === 'tasks',
    );
    const outcome = await run(
      request('Compare current and weekly weather', {
        instances: tasks,
        layout: { type: 'tiling', tree: ['ID:tasks-main'], instances: tasks },
      }),
      {
        views: {
          'weather-jev-1': 'show/current',
          'weather-jev-2': 'show/weekly',
        },
      },
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      value: {
        response: {
          executionPlan: [],
          layout: {
            instances: expect.arrayContaining([
              {
                instanceId: 'weather-jev-1',
                vesselId: 'weather',
                variant: 'current',
              },
              {
                instanceId: 'weather-jev-2',
                vesselId: 'weather',
                variant: 'weekly',
              },
            ]),
          },
        },
      },
    });
    expect(outcome.seen[0].questions).toHaveProperty('new/weather');
    expect(outcome.seen[0].questions).not.toHaveProperty('view/weather-jev-1');
  });

  test('accepts four ordered actions and requires done instead of shipping a truncated fifth action', async () => {
    const actions = [
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        params: { location: 'Montevideo' },
      },
      {
        instanceId: 'tasks-main',
        action: 'complete',
        params: { title: 'Buy milk' },
      },
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        params: { location: 'Paris' },
      },
      {
        instanceId: 'tasks-main',
        action: 'complete',
        params: { title: 'Send invoice' },
      },
    ];
    const accepted = await run(
      request(
        'Set weather to "Montevideo", complete Buy milk, then set weather to "Paris" and complete Send invoice',
      ),
      { actions },
    );
    expect(accepted.result).toMatchObject({
      ok: true,
      value: { response: { executionPlan: actions } },
    });
    expect(accepted.seen).toHaveLength(11);
    const refused = await run(
      request(
        'Set weather to "Montevideo", complete Buy milk, set weather to "Paris", complete Send invoice, then complete Buy milk again',
      ),
      {
        actions: [
          ...actions,
          {
            instanceId: 'tasks-main',
            action: 'complete',
            params: { title: 'Send invoice' },
          },
        ],
      },
    );
    expect(refused.result).toMatchObject({
      ok: false,
      error: { _tag: 'PlanningDeferredError', reason: 'policy' },
    });
    expect(refused.history).toEqual({ ok: true, value: [] });
    expect(refused.seen).toHaveLength(11);
  });

  test('sizes layouts for the chosen larger view rather than the discarded starting view', async () => {
    const base = request('Switch weather to weekly');
    const vessels = base.vessels.map((vessel) => ({
      ...vessel,
      variants: Object.fromEntries(
        Object.entries(vessel.variants).map(([name, variant]) => [
          name,
          {
            ...variant,
            minSize:
              name === 'weekly' ? { width: 26, height: 1 } : variant.minSize,
          },
        ]),
      ),
    }));
    const outcome = await run(
      request('Switch weather to weekly', { vessels }),
      {
        layout: 'column',
        views: { 'weather-main': 'show/weekly' },
      },
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      value: {
        response: {
          layout: {
            tree: ['H', 'ID:weather-main', 'ID:tasks-main'],
            instances: expect.arrayContaining([
              {
                instanceId: 'weather-main',
                vesselId: 'weather',
                variant: 'weekly',
              },
            ]),
          },
          executionPlan: [],
        },
      },
    });
  });
  test('selects views before offering layout choices and derives zero actions from done', async () => {
    const base = request('Show weather');
    const tasks = base.instances.filter((i) => i.vesselId === 'tasks');
    const outcome = await run(
      request('Show weather', {
        instances: tasks,
        layout: { type: 'tiling', tree: ['ID:tasks-main'], instances: tasks },
      }),
      { views: { 'weather-jev-1': 'show/current' } },
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      value: {
        response: {
          executionPlan: [],
          layout: {
            instances: [
              ...tasks,
              {
                instanceId: 'weather-jev-1',
                vesselId: 'weather',
                variant: 'current',
              },
            ],
          },
        },
      },
    });
    expect(outcome.seen[0].questions).not.toHaveProperty('layout');
    expect(outcome.seen.every((p) => !('actionCount' in p.questions))).toBe(
      true,
    );
    expect(
      outcome.seen
        .flatMap((p) => Object.keys(p.questions))
        .some((id) => id.startsWith('create/')),
    ).toBe(false);
    expect(outcome.seen[1].questions).toHaveProperty('layout');
    expect(outcome.seen[2].questions['action/0'].criteria).toHaveProperty(
      'done',
    );
  });

  test('puts desired views in the layout without redundant variant-transition actions', async () => {
    const menus: string[][] = [];
    const outcome = await run(request('Show weekly weather'), {
      views: { 'weather-main': 'show/weekly' },
      inspect(payload) {
        if (payload.state.availableActions)
          menus.push(
            payload.state.availableActions
              .filter((a) => a.instanceId === 'weather-main')
              .map((a) => a.action),
          );
      },
    });
    expect(outcome.result).toMatchObject({
      ok: true,
      value: {
        response: {
          layout: {
            instances: expect.arrayContaining([
              {
                instanceId: 'weather-main',
                vesselId: 'weather',
                variant: 'weekly',
              },
            ]),
          },
          executionPlan: [],
        },
      },
    });
    expect(menus[0]).not.toContain('showWeekly');
    expect(menus[0]).not.toContain('showCurrent');
    expect(menus).toHaveLength(1);
  });

  test('refuses a content action unavailable in the chosen post-layout variant', async () => {
    const outcome = await run(request('Show weekly weather'), {
      views: { 'weather-main': 'show/weekly' },
      actions: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Montevideo' },
        },
      ],
    });
    expect(outcome.result).toMatchObject({
      ok: false,
      error: { _tag: 'PlanningDeferredError' },
    });
    expect(outcome.history).toEqual({ ok: true, value: [] });
  });

  test('allows a retained hidden target but excludes a deleted target from every action menu', async () => {
    const outcome = await run(
      request('Hide the task list and complete Buy milk'),
      {
        views: { 'tasks-main': 'hide', 'weather-main': 'delete' },
        actions: [
          {
            instanceId: 'tasks-main',
            action: 'complete',
            params: { title: 'Buy milk' },
          },
        ],
        inspect(payload) {
          expect(
            payload.state.availableActions?.some(
              (a) => a.instanceId === 'weather-main',
            ) ?? false,
          ).toBe(false);
        },
      },
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      value: {
        response: {
          executionPlan: [
            {
              instanceId: 'tasks-main',
              action: 'complete',
              params: { title: 'Buy milk' },
            },
          ],
        },
      },
    });
  });

  test('offers only layouts that satisfy each selected variant minimum size', async () => {
    const base = request('Arrange both');
    const vessels = base.vessels.map((v) => ({
      ...v,
      variants: Object.fromEntries(
        Object.entries(v.variants).map(([name, variant]) => [
          name,
          { ...variant, minSize: { width: 6, height: 4 } },
        ]),
      ),
    }));
    const outcome = await run(
      request('Arrange both', {
        vessels,
        context: {
          ...base.context,
          chartDimensions: { columns: 10, rows: 10 },
        },
      }),
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      value: {
        response: {
          layout: { tree: ['H', 'ID:weather-main', 'ID:tasks-main'] },
        },
      },
    });
    expect(
      outcome.seen.every(
        (p) => !p.questions.layout || !('row' in p.questions.layout.criteria),
      ),
    ).toBe(true);
  });

  test('defers when no complete layout fits rather than omitting a requested instance', async () => {
    const base = request('Arrange both');
    const vessels = base.vessels.map((v) => ({
      ...v,
      variants: Object.fromEntries(
        Object.entries(v.variants).map(([name, variant]) => [
          name,
          { ...variant, minSize: { width: 8, height: 8 } },
        ]),
      ),
    }));
    const outcome = await run(
      request('Arrange both', {
        vessels,
        context: {
          ...base.context,
          chartDimensions: { columns: 10, rows: 10 },
        },
      }),
    );
    expect(outcome.result).toMatchObject({
      ok: false,
      error: { _tag: 'PlanningDeferredError', reason: 'policy' },
    });
    expect(outcome.seen).toHaveLength(1);
    expect(outcome.history).toEqual({ ok: true, value: [] });
  });

  test('binds each action before the next action decision and asks only for its parameters', async () => {
    const actions = [
      {
        instanceId: 'weather-main',
        action: 'setLocation',
        params: { location: 'Montevideo' },
      },
      {
        instanceId: 'tasks-main',
        action: 'complete',
        params: { title: 'Buy milk' },
      },
    ];
    const outcome = await run(
      request('Set weather to "Montevideo" and complete Buy milk'),
      { actions },
    );
    expect(outcome.result).toMatchObject({
      ok: true,
      value: { response: { executionPlan: actions } },
    });
    expect(
      outcome.seen
        .filter((p) =>
          Object.keys(p.questions).some((id) => id.startsWith('param/')),
        )
        .map((p) => Object.keys(p.questions)),
    ).toEqual([['param/0/location'], ['param/1/title']]);
    expect(
      outcome.seen.find((p) => 'action/1' in p.questions)?.state
        .previousActions?.[0].params,
    ).toEqual({ location: 'Montevideo' });
    expect(
      outcome.seen.filter((p) =>
        Object.keys(p.questions).some((id) => id.startsWith('action/')),
      ),
    ).toHaveLength(3);
  });

  test('does not spend a parameter call or persist a partial plan after the shared budget expires', async () => {
    const outcome = await run(request('Set weather to "Montevideo"'), {
      actions: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Montevideo' },
        },
      ],
      budget: 3,
    });
    expect(outcome.result).toMatchObject({
      ok: false,
      error: { _tag: 'PlanningBudgetExceededError' },
    });
    expect(outcome.seen).toHaveLength(3);
    expect(
      outcome.seen.some((p) =>
        Object.keys(p.questions).some((id) => id.startsWith('param/')),
      ),
    ).toBe(false);
    expect(outcome.history).toEqual({ ok: true, value: [] });
  });
});
