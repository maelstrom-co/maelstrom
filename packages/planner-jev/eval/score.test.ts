import { describe, expect, test } from 'bun:test';

import type { MaelstromResponse } from '@maelstrom-co/protocol';

import { type Expectation, type Scenario, scenarios } from './scenarios.js';
import {
  scoreActions,
  scoreLayout,
  scoreResponse,
  scoreSelection,
} from './score.js';

function scenario(id: string): Scenario {
  const found = scenarios.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no scenario ${id}`);
  return found;
}

function response(
  from: Scenario,
  options: {
    readonly tree?: readonly (string | null)[];
    readonly extra?: readonly {
      instanceId: string;
      vesselId: string;
      variant: string;
    }[];
    readonly variants?: Readonly<Record<string, string>>;
    readonly actions?: readonly {
      instanceId: string;
      action: string;
      params?: Record<string, unknown>;
    }[];
  } = {},
): MaelstromResponse {
  const tree =
    from.request.layout.type === 'tiling' ? from.request.layout.tree : [];
  return {
    type: 'maelstrom_response',
    requestId: 'r',
    userMessage: 'ok',
    rationale: 'r',
    executionPlan: options.actions ?? [],
    layout: {
      type: 'tiling',
      tree: options.tree ?? tree,
      instances: [
        ...from.request.instances.map((instance) => ({
          ...instance,
          variant: options.variants?.[instance.instanceId] ?? instance.variant,
        })),
        ...(options.extra ?? []),
      ],
    },
  } as unknown as MaelstromResponse;
}

describe('scoreResponse', () => {
  test('passes a response that matches the expectation', () => {
    const quoted = scenario('quoted-location');
    expect(
      scoreResponse(
        quoted,
        response(quoted, {
          actions: [
            {
              instanceId: 'weather-main',
              action: 'setLocation',
              params: { location: 'Tokyo' },
            },
          ],
        }),
      ),
    ).toEqual({ pass: true, failures: [] });
  });

  test('fails a wrong visible set', () => {
    const hide = scenario('hide');
    const score = scoreResponse(hide, response(hide));
    expect(score.pass).toBe(false);
    expect(score.failures[0]).toContain('Visible instances');
  });

  test('fails actions in the wrong order', () => {
    const twoActions = scenario('two-actions');
    const score = scoreResponse(
      twoActions,
      response(twoActions, {
        actions: [
          { instanceId: 'weather-main', action: 'showHourly' },
          {
            instanceId: 'weather-main',
            action: 'setLocation',
            params: { location: 'Tokyo' },
          },
        ],
      }),
    );
    expect(score.pass).toBe(false);
    expect(score.failures[0]).toContain('Ordered actions');
  });

  test('fails a wrong parameter value', () => {
    const quoted = scenario('quoted-location');
    const score = scoreResponse(
      quoted,
      response(quoted, {
        actions: [
          {
            instanceId: 'weather-main',
            action: 'setLocation',
            params: { location: 'Kyoto' },
          },
        ],
      }),
    );
    expect(score.pass).toBe(false);
  });

  test('ignores parameters an expectation leaves unscored', () => {
    const unquoted = scenario('hold-unquoted');
    expect(
      scoreResponse(
        unquoted,
        response(unquoted, {
          actions: [
            {
              instanceId: 'tasks-main',
              action: 'addTask',
              params: { title: 'passport' },
            },
          ],
        }),
      ).pass,
    ).toBe(true);
  });

  test('passes a variant the shipped execution plan transitions to', () => {
    const variant = scenario('variant');
    const score = scoreResponse(
      variant,
      response(variant, {
        variants: { 'weather-main': 'weekly' },
        actions: [{ instanceId: 'weather-main', action: 'showWeekly' }],
      }),
    );
    expect(score).toEqual({ pass: true, failures: [] });
  });

  test('fails a variant no shipped action transitions to', () => {
    const variant = scenario('variant');
    const score = scoreResponse(
      variant,
      response(variant, { variants: { 'weather-main': 'weekly' } }),
    );
    expect(score.pass).toBe(false);
    expect(score.failures.join()).toContain(
      'Variant of weather-main is weekly, but the execution plan leaves it current',
    );
  });

  test('fails an execution plan the engine rule cannot simulate', () => {
    const variant = scenario('variant');
    const score = scoreResponse(
      variant,
      response(variant, {
        actions: [{ instanceId: 'weather-main', action: 'showCurrent' }],
      }),
    );
    expect(score.pass).toBe(false);
    expect(score.failures.join()).toContain(
      'Execution plan does not simulate: showCurrent on weather-main (action_not_valid)',
    );
  });

  test('matches a baseline’s own new-instance ids by Vessel and order', () => {
    const create = scenario('create-configure');
    const score = scoreResponse(
      create,
      response(create, {
        tree: [
          'V:1,1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:weather-2',
        ],
        extra: [
          { instanceId: 'weather-2', vesselId: 'weather', variant: 'current' },
        ],
        actions: [
          {
            instanceId: 'weather-2',
            action: 'setLocation',
            params: { location: 'Paris' },
          },
        ],
      }),
    );
    expect(score).toEqual({ pass: true, failures: [] });
  });
});

describe('stage scores', () => {
  test('selection compares visible and retained sets', () => {
    const hide = scenario('hide');
    const selection = {
      input: { request: hide.request },
      answers: [],
      instances: hide.request.instances.map((instance) => ({
        ...instance,
        fresh: false,
        visible: ['calendar-main', 'tasks-main'].includes(instance.instanceId),
        decision: 'keep',
      })),
    } as never;
    expect(scoreSelection(hide, selection)?.pass).toBe(true);
  });

  test('actions count a pending slot the expectation has a value for, and asks', () => {
    const capital = scenario('se-capital');
    const pending = {
      actions: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: {},
          pending: [{ name: 'location', type: 'string', description: 'x' }],
        },
      ],
      asks: [],
    } as never;
    expect(scoreActions(capital, pending)?.pass).toBe(true);
    const addTask = scenario('ns-add-task');
    const asked = {
      actions: [],
      asks: [
        {
          instanceId: 'tasks-main',
          action: 'addTask',
          parameter: { name: 'title', type: 'string', description: 'x' },
        },
      ],
    } as never;
    expect(scoreActions(addTask, asked)?.pass).toBe(true);
    expect(
      scoreActions(addTask, { actions: [], asks: [] } as never)?.pass,
    ).toBe(false);
  });
});

describe('arrangement rules', () => {
  const preserve = scenario('preserve');
  const base: Scenario = {
    ...preserve,
    expected: { ...preserve.expected, arrangement: undefined },
  };
  const arranged = (rules: Expectation['arrangement']): Scenario => ({
    ...base,
    expected: { ...base.expected, arrangement: rules },
  });
  const swapped = [
    'V:1,1,1',
    'ID:tasks-main',
    'ID:weather-main',
    'ID:calendar-main',
  ];

  test('a rule-less scenario scores as before, without an arrangement score', () => {
    const score = scoreResponse(base, response(base));
    expect(score.arrangement).toBe(undefined);
    expect(score).toEqual({ pass: true, failures: [] });
  });

  test('passing rules keep the response passing and report the arrangement', () => {
    const score = scoreResponse(
      arranged([
        { kind: 'leftOf', a: 'calendar-main', b: 'weather-main' },
        { kind: 'unchangedTree' },
      ]),
      response(base),
    );
    expect(score).toEqual({
      pass: true,
      failures: [],
      arrangement: { pass: true, failures: [] },
    });
  });

  test('each failed rule is listed and fails the response', () => {
    const score = scoreResponse(
      arranged([
        { kind: 'leftOf', a: 'calendar-main', b: 'weather-main' },
        { kind: 'unchangedTree' },
        { kind: 'order', ids: ['weather-main', 'tasks-main'], axis: 'x' },
      ]),
      response(base, { tree: swapped }),
    );
    expect(score.pass).toBe(false);
    expect(score.arrangement?.failures).toHaveLength(3);
    expect(score.failures).toHaveLength(3);
    expect(score.failures[0]).toStartWith(
      'Arrangement leftOf(calendar-main, weather-main): calendar-main spans x=20..30',
    );
    expect(score.failures[1]).toStartWith(
      'Arrangement unchangedTree(): expected',
    );
  });

  test('rules name the expected ids of instances a planner created', () => {
    const create = scenario('create-configure');
    const withRule: Scenario = {
      ...create,
      expected: {
        ...create.expected,
        arrangement: [{ kind: 'rightOf', a: 'weather-jev-1', b: 'tasks-main' }],
      },
    };
    const score = scoreResponse(
      withRule,
      response(create, {
        tree: [
          'V:1,1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:weather-2',
        ],
        extra: [
          { instanceId: 'weather-2', vesselId: 'weather', variant: 'current' },
        ],
        actions: [
          {
            instanceId: 'weather-2',
            action: 'setLocation',
            params: { location: 'Paris' },
          },
        ],
      }),
    );
    expect(score.arrangement).toEqual({ pass: true, failures: [] });
    expect(score.pass).toBe(true);
  });

  test('a non-tiling response fails the rules it could not be checked against', () => {
    const rules = arranged([{ kind: 'unchangedTree' }]);
    const grid = {
      ...response(rules),
      layout: { type: 'grid', positions: [], instances: [] },
    } as unknown as MaelstromResponse;
    expect(scoreResponse(rules, grid)).toEqual({
      pass: false,
      failures: ['Response layout is not tiling'],
      arrangement: { pass: false, failures: ['Response layout is not tiling'] },
    });
    expect(scoreResponse(base, grid)).toEqual({
      pass: false,
      failures: ['Response layout is not tiling'],
    });
  });

  test('the layout stage is scored on its tree too', () => {
    const rules = arranged([{ kind: 'unchangedTree' }]);
    const plan = (tree: readonly string[]) =>
      ({ tree, layoutId: 'x', answers: [] }) as never;
    expect(scoreLayout(rules, plan(swapped))?.failures).toEqual([
      expect.stringMatching(/^Arrangement unchangedTree\(\): expected/),
    ]);
    expect(
      scoreLayout(
        rules,
        plan([
          'V:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ]),
      )?.pass,
    ).toBe(true);
  });
});
