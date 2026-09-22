import type { LLMContextMessage } from '@maelstrom-co/engine';
import {
  type ChartRequest,
  ChartRequestSchema,
  type Vessel,
  VesselSchema,
} from '@maelstrom-co/protocol';

import type { StageName } from '../src/lib/defer.js';
import { demoVessels } from './fixtures/demo-vessels.js';

export type Suite = 'development' | 'holdout';

export interface ExpectedAction {
  readonly instanceId: string;
  readonly action: string;
  /** Omitted: the parameters are not scored. */
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ExpectedAsk {
  readonly instanceId: string;
  readonly action: string;
  readonly parameter: string;
}

export interface Expectation {
  readonly status: 'planned' | 'deferred';
  /** For `deferred`: the POC stage that should defer. Omitted: any stage. */
  readonly deferStage?: StageName;
  readonly visible?: readonly string[];
  readonly retained?: readonly string[];
  /** Recorded in the report, not scored. */
  readonly tree?: readonly (string | null)[];
  readonly actions?: readonly ExpectedAction[];
  /** Values the POC should ask the user for, its actions dropped. */
  readonly asks?: readonly ExpectedAsk[];
}

export interface Scenario {
  readonly id: string;
  readonly suite: Suite;
  readonly title: string;
  readonly request: ChartRequest;
  /** Prior conversation handed to the planner. */
  readonly history?: readonly LLMContextMessage[];
  readonly expected: Expectation;
}

interface InputOptions {
  readonly tree?: readonly (string | null)[];
  readonly variants?: Readonly<Record<string, string>>;
  readonly columns?: number;
  readonly rows?: number;
  readonly vessels?: readonly Vessel[];
  readonly resizeFrom?: { readonly columns: number; readonly rows: number };
}

const BASE_TREE = [
  'V:1,1,1',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
];
const BASE_VISIBLE = ['calendar-main', 'weather-main', 'tasks-main'];
const BASE_RETAINED = [...BASE_VISIBLE, 'map-main', 'journal-main'];

const development: Scenario[] = [
  planned(
    'preserve',
    'Keep the current board',
    'Leave the board exactly as it is.',
    {
      visible: BASE_VISIBLE,
      actions: [],
      tree: BASE_TREE,
    },
  ),
  planned(
    'show-hidden',
    'Show the existing map',
    'Show the map next to the current widgets.',
    {
      visible: [...BASE_VISIBLE, 'map-main'],
      retained: BASE_RETAINED,
      actions: [],
    },
  ),
  planned(
    'hide',
    'Hide weather without deleting it',
    'Hide the weather, keep the rest.',
    {
      visible: ['calendar-main', 'tasks-main'],
      retained: BASE_RETAINED,
      actions: [],
    },
  ),
  planned(
    'replace-side-by-side',
    'Naming the whole screen hides the rest',
    'Show me the weather in Warsaw and the calendar in week view side by side.',
    {
      visible: ['calendar-main', 'weather-main'],
      retained: BASE_RETAINED,
      actions: [
        setLocation('weather-main', 'Warsaw'),
        { instanceId: 'calendar-main', action: 'showWeek' },
      ],
    },
  ),
  planned(
    'additive-show',
    'Adding a widget keeps the rest',
    'Also show the map.',
    {
      visible: [...BASE_VISIBLE, 'map-main'],
      retained: BASE_RETAINED,
      actions: [],
    },
  ),
  planned('remove', 'Remove hides the named widget', 'Remove the tasks.', {
    visible: ['calendar-main', 'weather-main'],
    retained: BASE_RETAINED,
    actions: [],
  }),
  planned(
    'delete',
    'Delete an instance explicitly',
    'Delete the weather widget and its instance.',
    {
      visible: ['calendar-main', 'tasks-main'],
      retained: BASE_RETAINED.filter((id) => id !== 'weather-main'),
      actions: [],
    },
  ),
  planned(
    'focus',
    'Give the calendar more space',
    'Give the calendar two thirds of the board. Stack weather and tasks on the right.',
    {
      visible: BASE_VISIBLE,
      actions: [],
      tree: [
        'V:2,1',
        'ID:calendar-main',
        'H',
        'ID:weather-main',
        'ID:tasks-main',
      ],
    },
  ),
  planned(
    'column',
    'Stack the visible widgets',
    'Stack the visible widgets vertically in equal rows.',
    {
      visible: BASE_VISIBLE,
      actions: [],
      tree: ['H:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
    },
  ),
  planned(
    'variant',
    'Switch weather to weekly',
    'Show the weekly forecast in the weather widget.',
    {
      visible: BASE_VISIBLE,
      actions: [{ instanceId: 'weather-main', action: 'showWeekly' }],
    },
  ),
  planned(
    'enum-route',
    'Select a saved map destination',
    'Show directions to Studio Vortex HQ on the map.',
    {
      visible: [...BASE_VISIBLE, 'map-main'],
      actions: [
        {
          instanceId: 'map-main',
          action: 'showRoute',
          params: { destination: 'Studio Vortex HQ' },
        },
      ],
    },
  ),
  planned(
    'quoted-location',
    'Copy a quoted location',
    'Set the weather location to "Tokyo".',
    {
      visible: BASE_VISIBLE,
      actions: [setLocation('weather-main', 'Tokyo')],
    },
  ),
  planned(
    'two-actions',
    'Configure weather then change its view',
    'First set weather to "Tokyo", then show its hourly forecast.',
    {
      visible: BASE_VISIBLE,
      actions: [
        setLocation('weather-main', 'Tokyo'),
        { instanceId: 'weather-main', action: 'showHourly' },
      ],
    },
  ),
  planned(
    'transition-sequence',
    'Resolve actions after a variant transition',
    'Switch weather to hourly, then back to current conditions.',
    {
      visible: BASE_VISIBLE,
      actions: [
        { instanceId: 'weather-main', action: 'showHourly' },
        { instanceId: 'weather-main', action: 'showCurrent' },
      ],
    },
  ),
  planned(
    'create-configure',
    'Create and configure another weather instance',
    'Add a second weather widget for "Paris". Keep everything else.',
    {
      visible: [...BASE_VISIBLE, 'weather-jev-1'],
      actions: [setLocation('weather-jev-1', 'Paris')],
    },
  ),
  planned(
    'compare',
    'Compare two weather locations',
    'Show only two weather widgets side by side: "Tokyo" on the left and "Paris" on the right. Reuse the existing weather widget for Tokyo.',
    {
      visible: ['weather-main', 'weather-jev-1'],
      tree: ['V', 'ID:weather-main', 'ID:weather-jev-1'],
      actions: [
        setLocation('weather-main', 'Tokyo'),
        setLocation('weather-jev-1', 'Paris'),
      ],
    },
  ),
  planned(
    'task',
    'Add a task from a source span',
    'Add a task called "Buy milk".',
    {
      visible: BASE_VISIBLE,
      actions: [addTask('Buy milk')],
    },
  ),
  planned(
    'unquoted-location',
    'Bind an unquoted location from a span',
    'Set the weather to Tokyo.',
    {
      visible: BASE_VISIBLE,
      actions: [setLocation('weather-main', 'Tokyo')],
    },
  ),
  deferred(
    'missing-enum',
    'Destination outside the catalog',
    'Show directions to the moon.',
  ),
  deferred(
    'generate-content',
    'New prose is outside this planner',
    'Write a new poem about the sea in my journal.',
    'jevSelect',
  ),
  planned(
    'too-many-actions',
    'Three writes fit the action budget',
    'Add tasks "One", "Two", and "Three".',
    {
      visible: BASE_VISIBLE,
      actions: [addTask('One'), addTask('Two'), addTask('Three')],
    },
  ),
  deferred(
    'ambiguous',
    'Unresolved reference',
    'Delete that one.',
    'jevSelect',
  ),
  deferred(
    'small-chart',
    'No layout gives every widget its minimum size',
    'Put calendar, weather, and tasks side by side.',
    'jevLayout',
    { columns: 10, rows: 6 },
  ),
  {
    id: 'resize',
    suite: 'development',
    title: 'Resize without replaying a task write',
    request: request('', {
      columns: 12,
      rows: 20,
      resizeFrom: { columns: 30, rows: 18 },
    }),
    history: [
      { role: 'user', content: 'Add a task called "Buy milk".' },
      { role: 'assistant', content: 'Added "Buy milk" to your tasks.' },
    ],
    expected: { status: 'planned', visible: BASE_VISIBLE, actions: [] },
  },
  {
    id: 'followup',
    suite: 'development',
    title: 'Resolve a follow-up from history',
    request: request('Now show its weekly forecast.'),
    history: [
      { role: 'user', content: 'Set weather to "Tokyo".' },
      { role: 'assistant', content: 'The weather widget now shows Tokyo.' },
    ],
    expected: {
      status: 'planned',
      visible: BASE_VISIBLE,
      actions: [{ instanceId: 'weather-main', action: 'showWeekly' }],
    },
  },
  planned(
    'runtime-enum',
    'Select an existing task from runtime options',
    'Mark Buy milk as complete.',
    {
      visible: BASE_VISIBLE,
      actions: [
        {
          instanceId: 'tasks-main',
          action: 'checkTask',
          params: { title: 'Buy milk' },
        },
      ],
    },
    { vessels: withTaskTitles(['Buy milk', 'Send invoice']) },
  ),
  deferred('tiny-resize', 'A tiny Chart fits no widget', '', 'jevLayout', {
    columns: 2,
    rows: 2,
    resizeFrom: { columns: 30, rows: 18 },
  }),
];

const holdout: Scenario[] = [
  planned(
    'hold-preserve',
    'Leave the workspace untouched',
    'Everything looks right. Keep it this way.',
    {
      visible: BASE_VISIBLE,
      retained: BASE_RETAINED,
      actions: [],
    },
  ),
  planned(
    'hold-hide',
    'Hide one of two visible widgets',
    'Take the forecast off screen and leave my calendar alone.',
    { visible: ['calendar-main'], retained: BASE_RETAINED, actions: [] },
    { tree: ['V', 'ID:calendar-main', 'ID:weather-main'] },
  ),
  planned(
    'hold-show',
    'Bring back a hidden checklist',
    'Bring back my task list beside the calendar.',
    {
      visible: ['calendar-main', 'tasks-main'],
      retained: BASE_RETAINED,
      actions: [],
    },
    { tree: ['ID:calendar-main'] },
  ),
  planned(
    'hold-weather-variant',
    'Return from weekly to current weather',
    'Switch the weather widget back to current conditions.',
    {
      visible: BASE_VISIBLE,
      actions: [{ instanceId: 'weather-main', action: 'showCurrent' }],
    },
    { variants: { weather: 'weekly' } },
  ),
  planned(
    'hold-calendar-variant',
    'Switch the calendar to monthly',
    'Switch my calendar from the week view to the month view.',
    {
      visible: BASE_VISIBLE,
      actions: [{ instanceId: 'calendar-main', action: 'showMonth' }],
    },
    { variants: { calendar: 'week' } },
  ),
  planned(
    'hold-map-route',
    'Find the route to a named workplace',
    'I need driving directions to Studio Vortex HQ. Bring up the map.',
    {
      visible: [...BASE_VISIBLE, 'map-main'],
      actions: [
        {
          instanceId: 'map-main',
          action: 'showRoute',
          params: { destination: 'Studio Vortex HQ' },
        },
      ],
    },
  ),
  planned(
    'hold-two-writes',
    'Perform two distinct task writes',
    'Add "Review budget" to my tasks, then add "Book taxi".',
    {
      visible: BASE_VISIBLE,
      actions: [addTask('Review budget'), addTask('Book taxi')],
    },
  ),
  planned(
    'hold-event',
    'Pair an event title with its time',
    'Add "Dentist" to today’s calendar at "15:00".',
    {
      visible: BASE_VISIBLE,
      actions: [
        {
          instanceId: 'calendar-main',
          action: 'addEvent',
          params: { title: 'Dentist', time: '15:00' },
        },
      ],
    },
  ),
  planned(
    'hold-new-instance',
    'Add another weather view for Oslo',
    'Keep my current board. Open one additional weather widget for "Oslo".',
    {
      visible: [...BASE_VISIBLE, 'weather-jev-1'],
      actions: [setLocation('weather-jev-1', 'Oslo')],
    },
  ),
  planned(
    'hold-comparison',
    'Configure two named comparison subjects',
    'Show only two weather panels side by side. Set the existing one on the left to "Oslo" and create one on the right for "Rome".',
    {
      visible: ['weather-main', 'weather-jev-1'],
      tree: ['V', 'ID:weather-main', 'ID:weather-jev-1'],
      actions: [
        setLocation('weather-main', 'Oslo'),
        setLocation('weather-jev-1', 'Rome'),
      ],
    },
  ),
  planned(
    'hold-stack',
    'Rearrange two visible widgets on a tall Chart',
    'Keep exactly these visible widgets, but put them in equal rows from top to bottom.',
    {
      visible: ['calendar-main', 'tasks-main'],
      tree: ['H', 'ID:calendar-main', 'ID:tasks-main'],
      actions: [],
    },
    { tree: ['V', 'ID:calendar-main', 'ID:tasks-main'], columns: 10, rows: 30 },
  ),
  planned(
    'hold-three-writes',
    'Three writes fit the action budget',
    'Create three tasks: "Call Sam", "Pay rent", and "Water plants".',
    {
      visible: BASE_VISIBLE,
      actions: [
        addTask('Call Sam'),
        addTask('Pay rent'),
        addTask('Water plants'),
      ],
    },
  ),
  deferred(
    'hold-unknown-vessel',
    'Refuse an unavailable trading widget',
    'Open a stock trading widget and place a buy order.',
    'jevSelect',
  ),
  deferred(
    'hold-generated-content',
    'Refuse new generated journal content',
    'Write an original bedtime story about a fox in my journal.',
  ),
  planned(
    'hold-unquoted',
    'Add an unquoted task title',
    'Add a task to remember the passport.',
    {
      visible: BASE_VISIBLE,
      actions: [{ instanceId: 'tasks-main', action: 'addTask' }],
    },
  ),
  deferred(
    'hold-ambiguous',
    'Refuse an unresolved destructive reference',
    'Delete the one I was thinking of.',
    'jevSelect',
  ),
];

const parameterCases: Scenario[] = [
  planned(
    'se-capital',
    'A location stated as a description',
    'Show the weather for the capital of Japan.',
    {
      visible: BASE_VISIBLE,
      actions: [setLocation('weather-main', 'Tokyo')],
    },
  ),
  planned(
    'se-landmark',
    'A location stated through a landmark',
    'Set the weather to the city where the Eiffel Tower stands.',
    { visible: BASE_VISIBLE, actions: [setLocation('weather-main', 'Paris')] },
  ),
  planned(
    'se-olympics',
    'A location stated through an event',
    'Show the weather for the city that hosted the 2012 Summer Olympics.',
    { visible: BASE_VISIBLE, actions: [setLocation('weather-main', 'London')] },
  ),
  planned('ns-add-task', 'A task without a title', 'Add a task.', {
    visible: BASE_VISIBLE,
    actions: [],
    asks: [{ instanceId: 'tasks-main', action: 'addTask', parameter: 'title' }],
  }),
  planned(
    'ns-weather-somewhere',
    'Weather without a place',
    'Show the weather somewhere.',
    {
      actions: [],
      asks: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          parameter: 'location',
        },
      ],
    },
  ),
  planned(
    'ns-add-event',
    'An event without a title or time',
    'Add an event to my calendar.',
    {
      actions: [],
      asks: [
        { instanceId: 'calendar-main', action: 'addEvent', parameter: 'title' },
      ],
    },
  ),
];

/** Every scenario: the ported development and holdout suites plus the parameter cases, which join development. */
export const scenarios: readonly Scenario[] = [
  ...development,
  ...parameterCases.map((scenario) => ({
    ...scenario,
    suite: 'development' as const,
  })),
  ...holdout.map((scenario) => ({ ...scenario, suite: 'holdout' as const })),
];

/** Scenarios of `suite` (`all` for every one). */
export function selectScenarios(
  suite: Suite | 'all',
  ids: readonly string[] = [],
): readonly Scenario[] {
  return scenarios.filter(
    (scenario) =>
      (suite === 'all' || scenario.suite === suite) &&
      (ids.length === 0 || ids.includes(scenario.id)),
  );
}

function planned(
  id: string,
  title: string,
  intent: string,
  expected: Omit<Expectation, 'status'>,
  options: InputOptions = {},
): Scenario {
  return {
    id,
    suite: 'development',
    title,
    request: request(intent, options),
    expected: { status: 'planned', ...expected },
  };
}

function deferred(
  id: string,
  title: string,
  intent: string,
  deferStage?: StageName,
  options: InputOptions = {},
): Scenario {
  return {
    id,
    suite: 'development',
    title,
    request: request(intent, options),
    expected: { status: 'deferred', ...(deferStage && { deferStage }) },
  };
}

function request(intent: string, options: InputOptions = {}): ChartRequest {
  const vessels = options.vessels ?? demoVessels;
  const instances = ['calendar', 'weather', 'tasks', 'map', 'journal'].map(
    (id) => {
      const vessel = vessels.find((v) => v.id === id);
      if (!vessel) throw new Error(`unknown fixture Vessel ${id}`);
      return {
        instanceId: `${id}-main`,
        vesselId: id,
        variant: options.variants?.[id] ?? vessel.defaultVariant,
      };
    },
  );
  const current = { columns: options.columns ?? 30, rows: options.rows ?? 18 };
  return ChartRequestSchema.parse({
    type: 'chart_request',
    context: {
      layoutMode: 'tiling',
      chartDimensions: current,
      updateReasons: options.resizeFrom
        ? [{ type: 'chart_resize', previous: options.resizeFrom, current }]
        : [{ type: 'user_intent', intent }],
    },
    instances,
    vessels,
    layout: { type: 'tiling', tree: options.tree ?? BASE_TREE, instances },
  });
}

function setLocation(instanceId: string, location: string): ExpectedAction {
  return { instanceId, action: 'setLocation', params: { location } };
}

function addTask(title: string): ExpectedAction {
  return { instanceId: 'tasks-main', action: 'addTask', params: { title } };
}

function withTaskTitles(titles: readonly string[]): readonly Vessel[] {
  return demoVessels.map((vessel) =>
    vessel.id !== 'tasks'
      ? vessel
      : VesselSchema.parse({
          ...vessel,
          variants: Object.fromEntries(
            Object.entries(vessel.variants).map(([name, variant]) => [
              name,
              {
                ...variant,
                actions: variant.actions.map((action) => ({
                  ...action,
                  parameters: action.parameters?.map((parameter) =>
                    ['checkTask', 'removeTask', 'uncheckTask'].includes(
                      action.name,
                    ) && parameter.name === 'title'
                      ? { ...parameter, enum: [...titles] }
                      : action.name === 'addSubtask' &&
                          parameter.name === 'taskTitle'
                        ? { ...parameter, enum: [...titles] }
                        : parameter,
                  ),
                })),
              },
            ]),
          ),
        }),
  );
}
