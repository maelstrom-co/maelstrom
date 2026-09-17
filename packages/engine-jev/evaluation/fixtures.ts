import type { HistoryEntry } from '@maelstrom-co/engine';
import {
  ChartRequestMessage,
  ChartRequestSchema,
  MaelstromResponseSchema,
  MessageId,
  SessionId,
} from '@maelstrom-co/protocol';

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const instances = [
  { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
  { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
  { instanceId: 'weather-hidden', vesselId: 'weather', variant: 'current' },
];

export function request(
  intent: string,
  overrides: Record<string, unknown> = {},
) {
  return freeze(
    ChartRequestSchema.parse({
      type: 'chart_request',
      context: {
        layoutMode: 'tiling',
        chartDimensions: { columns: 30, rows: 18 },
        updateReasons: [{ type: 'user_intent', intent }],
      },
      vessels: [
        {
          id: 'weather',
          name: 'Weather',
          description: 'Weather forecast',
          defaultVariant: 'current',
          variants: {
            current: {
              props: {},
              minSize: { width: 1, height: 1 },
              actions: [
                {
                  name: 'setLocation',
                  description: 'Set city',
                  parameters: [
                    { name: 'location', type: 'string', description: 'City' },
                  ],
                },
                {
                  name: 'showWeekly',
                  description: 'Weekly forecast',
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
                  description: 'Current forecast',
                  transitionsTo: 'current',
                },
              ],
            },
          },
        },
        {
          id: 'tasks',
          name: 'Tasks',
          description: 'Task list',
          defaultVariant: 'list',
          variants: {
            list: {
              props: {},
              minSize: { width: 1, height: 1 },
              actions: [
                {
                  name: 'complete',
                  description: 'Complete saved task',
                  parameters: [
                    {
                      name: 'title',
                      type: 'string',
                      description: 'Saved task title',
                      enum: ['Buy milk', 'Send invoice'],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
      instances,
      layout: {
        type: 'tiling',
        tree: ['V:1,1', 'ID:weather-main', 'ID:tasks-main'],
        instances,
      },
      ...overrides,
    }),
  );
}

export type Backend = 'llm' | 'jev';
export type Action = {
  instanceId: string;
  action: string;
  params?: Record<string, unknown>;
};
export type Selections = Readonly<Record<string, string>>;
export type Script = {
  llm: unknown;
  jev: readonly Selections[];
  fault?: 'provider' | 'malformed' | 'cancel';
};
export type Fixture = {
  id: string;
  request: ReturnType<typeof request>;
  history: readonly HistoryEntry[];
  script: Script;
  fallback?: Script;
  maxCalls?: number;
};

function layout(tree: string[], retained = instances) {
  return { type: 'tiling', tree, instances: retained };
}
function output(layoutValue: unknown, actions: Action[] = []) {
  return {
    userMessage: 'Updated.',
    rationale: 'Scripted offline response.',
    layout: layoutValue,
    executionPlan: actions.map(({ params, ...action }) => ({
      ...action,
      ...(params ? { paramsJson: JSON.stringify(params) } : {}),
    })),
  };
}
function stage(overrides: Selections = {}): Selections {
  return {
    scope: 'supported',
    arrangement: 'preserve',
    primary: 'none',
    actionCount: '0',
    'presence/weather-main': 'unchanged',
    'presence/tasks-main': 'unchanged',
    'presence/weather-hidden': 'unchanged',
    'create/weather': '0',
    'create/tasks': '0',
    ...overrides,
  };
}
const base = request('Preserve this layout.');
const preserve: Script = { llm: output(base.layout), jev: [stage()] };
const hidden = layout(['ID:tasks-main']);
const deleted = layout(
  ['ID:tasks-main'],
  instances.filter((i) => i.instanceId !== 'weather-main'),
);
const shown = layout([
  'V:1,1,1',
  'ID:weather-main',
  'ID:tasks-main',
  'ID:weather-hidden',
]);
const newLayout = layout(
  ['V:1,1,1', 'ID:weather-main', 'ID:tasks-main', 'ID:weather-jev-1'],
  [
    ...instances,
    { instanceId: 'weather-jev-1', vesselId: 'weather', variant: 'current' },
  ],
);
const sourceAction = {
  instanceId: 'weather-main',
  action: 'setLocation',
  params: { location: 'Tokyo' },
};
const enumAction = {
  instanceId: 'tasks-main',
  action: 'complete',
  params: { title: 'Buy milk' },
};
const weekly = { instanceId: 'weather-main', action: 'showWeekly' };
const source: Script = {
  llm: output(base.layout, [sourceAction]),
  jev: [
    stage({ actionCount: '1' }),
    { 'action/0': 'weather-main/setLocation' },
    { 'param/0/location': 'v0' },
  ],
};
const weeklyScript: Script = {
  llm: output(base.layout, [weekly]),
  jev: [stage({ actionCount: '1' }), { 'action/0': 'weather-main/showWeekly' }],
};
const seedId = MessageId('retained-turn');
const sessionId = SessionId('offline');
const history: readonly HistoryEntry[] = freeze([
  {
    kind: 'turn',
    input: ChartRequestMessage({
      sessionId,
      id: seedId,
      timestamp: 1,
      request: request('Set the weather location to "Tokyo".'),
    }),
    output: {
      type: 'chart_response',
      id: seedId,
      sessionId,
      response: MaelstromResponseSchema.parse({
        type: 'maelstrom_response',
        requestId: seedId,
        layout: base.layout,
        executionPlan: [sourceAction],
      }),
    },
  },
]);
const grid = request('Preserve the grid.', {
  context: { ...base.context, layoutMode: 'grid' },
  layout: {
    type: 'grid',
    positions: [
      {
        instanceId: 'weather-main',
        position: { row: 0, column: 0 },
        size: { width: 2, height: 2 },
      },
    ],
  },
});
const invalidWeight = request('Preserve this tree.', {
  layout: layout(['V:0,2', 'ID:weather-main', 'ID:tasks-main']),
});

function fixture(
  id: string,
  input: ReturnType<typeof request>,
  script: Script,
  extra: Partial<Fixture> = {},
): Fixture {
  return freeze({ id, request: input, script, history: [], ...extra });
}

// Transport scripts are intentionally independent of the scoring labels.
export const fixtures: readonly Fixture[] = freeze([
  fixture('preserve', base, preserve),
  fixture(
    'show-hidden',
    request('Show the hidden weather panel and retain the others.'),
    {
      llm: output(shown),
      jev: [stage({ 'presence/weather-hidden': 'show', arrangement: 'row' })],
    },
  ),
  fixture(
    'hide',
    request('Hide the main weather panel, retaining its state.'),
    { llm: output(hidden), jev: [stage({ 'presence/weather-main': 'hide' })] },
  ),
  fixture('delete', request('Delete the main weather panel and its state.'), {
    llm: output(deleted),
    jev: [stage({ 'presence/weather-main': 'delete' })],
  }),
  fixture(
    'new-instance',
    request(
      'Create an additional weather panel for "Paris". Keep the hidden panel hidden.',
    ),
    {
      llm: output(newLayout, [
        {
          ...sourceAction,
          instanceId: 'weather-jev-1',
          params: { location: 'Paris' },
        },
      ]),
      jev: [
        stage({ 'create/weather': '1', actionCount: '1', arrangement: 'row' }),
        { 'action/0': 'weather-jev-1/setLocation' },
        { 'param/0/location': 'v0' },
      ],
    },
  ),
  fixture('ordered-transitions', request('Show weekly then current weather.'), {
    llm: output(base.layout, [
      weekly,
      { instanceId: 'weather-main', action: 'showCurrent' },
    ]),
    jev: [
      stage({ actionCount: '2' }),
      {
        'action/0': 'weather-main/showWeekly',
        'action/1': 'weather-main/showCurrent',
      },
    ],
  }),
  fixture(
    'source-parameter',
    request('Set main weather to "Tokyo", not "Paris".'),
    source,
  ),
  fixture('enum-parameter', request('Complete Buy milk, not Send invoice.'), {
    llm: output(base.layout, [enumAction]),
    jev: [
      stage({ actionCount: '1' }),
      { 'action/0': 'tasks-main/complete' },
      { 'param/0/title': 'v0' },
    ],
  }),
  fixture(
    'history-follow-up',
    request('Show the weekly forecast for the city from the last turn.'),
    weeklyScript,
    { history },
  ),
  fixture(
    'resize',
    request('', {
      context: {
        ...base.context,
        updateReasons: [
          {
            type: 'chart_resize',
            previous: { columns: 30, rows: 18 },
            current: { columns: 20, rows: 18 },
          },
        ],
      },
    }),
    { llm: output(base.layout), jev: [] },
  ),
  fixture('grid', grid, { llm: output(grid.layout), jev: [] }),
  fixture('wrong-layout', request('Preserve both visible panels.'), {
    llm: output(hidden),
    jev: [stage({ 'presence/weather-main': 'hide' })],
  }),
  fixture(
    'wrong-action',
    request('Keep the current forecast unchanged.'),
    weeklyScript,
  ),
  fixture(
    'wrong-parameter',
    request('Set main weather to "Tokyo", not "Paris".'),
    {
      llm: output(base.layout, [
        { ...sourceAction, params: { location: 'Paris' } },
      ]),
      jev: [
        stage({ actionCount: '1' }),
        { 'action/0': 'weather-main/setLocation' },
        { 'param/0/location': 'v1' },
      ],
    },
  ),
  fixture('unnecessary-deferral', base, {
    llm: preserve.llm,
    jev: [stage({ scope: 'ambiguous' })],
  }),
  fixture('ambiguity', request('Delete that one.'), {
    llm: output(base.layout, [{ instanceId: 'missing', action: 'delete' }]),
    jev: [stage({ scope: 'ambiguous' })],
  }),
  fixture('unquoted-source-parameter', request('Set main weather to Tokyo.'), {
    ...source,
    jev: [...source.jev.slice(0, 2), { 'param/0/location': 'v4' }],
  }),
  fixture(
    'candidate-gap',
    request(
      'Set main weather to coordinates latitude -34.9 and longitude -56.2.',
      {
        vessels: base.vessels.map((vessel) => ({
          ...vessel,
          variants: Object.fromEntries(
            Object.entries(vessel.variants).map(([name, variant]) => [
              name,
              {
                ...variant,
                actions: variant.actions.map((action) =>
                  action.name === 'setLocation'
                    ? {
                        ...action,
                        parameters: [
                          {
                            name: 'location',
                            type: 'object',
                            description: 'Latitude and longitude coordinates',
                          },
                        ],
                      }
                    : action,
                ),
              },
            ]),
          ),
        })),
      },
    ),
    {
      llm: output(base.layout, [
        {
          ...sourceAction,
          params: { location: { latitude: -34.9, longitude: -56.2 } },
        },
      ]),
      jev: source.jev.slice(0, 2),
    },
  ),
  fixture('strict-rejection', invalidWeight, {
    llm: output(invalidWeight.layout),
    jev: [stage()],
  }),
  fixture(
    'strict-fallback',
    invalidWeight,
    {
      llm: output(invalidWeight.layout),
      jev: [stage()],
    },
    { fallback: preserve, maxCalls: 2 },
  ),
  fixture(
    'wrong-retention',
    request('Hide the main weather panel, retaining its state.'),
    {
      llm: output(deleted),
      jev: [stage({ 'presence/weather-main': 'delete' })],
    },
  ),
  fixture(
    'wrong-arrangement',
    request('Keep both visible panels side by side.'),
    {
      llm: output(layout(['H:1,1', 'ID:weather-main', 'ID:tasks-main'])),
      jev: [stage({ arrangement: 'column' })],
    },
  ),
  fixture(
    'policy-limit',
    request('Set main weather to "Tokyo", then "Paris", then "Rome".'),
    {
      llm: output(
        base.layout,
        ['Tokyo', 'Paris', 'Rome'].map((location) => ({
          ...sourceAction,
          params: { location },
        })),
      ),
      jev: [stage({ actionCount: 'overflow' })],
    },
  ),
  fixture('provider-failure', base, { ...preserve, fault: 'provider' }),
  fixture('malformed-response', base, { ...preserve, fault: 'malformed' }),
  fixture(
    'cancel',
    base,
    { ...preserve, fault: 'cancel' },
    { fallback: preserve },
  ),
  fixture(
    'fallback',
    base,
    {
      llm: output(base.layout, [{ instanceId: 'missing', action: 'unknown' }]),
      jev: [stage({ scope: 'ambiguous' })],
    },
    { fallback: preserve, maxCalls: 2 },
  ),
  fixture(
    'fallback-budget',
    base,
    {
      llm: output(base.layout, [{ instanceId: 'missing', action: 'unknown' }]),
      jev: [stage({ scope: 'ambiguous' })],
    },
    { fallback: preserve, maxCalls: 1 },
  ),
  fixture('stage-budget', request('Show weekly weather.'), weeklyScript, {
    maxCalls: 1,
    fallback: preserve,
  }),
]);
