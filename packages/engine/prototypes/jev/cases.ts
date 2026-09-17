import {
  ActionName,
  ChartRequestSchema,
  InstanceId,
  type TilingNode,
  tilingLeafInstanceId,
  type Vessel,
  VesselSchema,
} from '@maelstrom-co/protocol';
import { withActionOptions } from '../../../../apps/demo/src/lib/vessel-options.ts';
import { calendarVessel } from '../../../../apps/demo/src/vessels/calendar.vessel.def.ts';
import { journalVessel } from '../../../../apps/demo/src/vessels/journal.vessel.def.ts';
import { mapVessel } from '../../../../apps/demo/src/vessels/map.vessel.def.ts';
import { tasksVessel } from '../../../../apps/demo/src/vessels/tasks.vessel.def.ts';
import { weatherVessel } from '../../../../apps/demo/src/vessels/weather.vessel.def.ts';
import { type Outcome, type PlanningInput, prepare } from './planner.ts';
import { type Judge, scriptedReply } from './typesafe.ts';

export const vessels: Vessel[] = [
  calendarVessel,
  weatherVessel,
  tasksVessel,
  mapVessel,
  journalVessel,
].map((v) => VesselSchema.parse(v));

interface Script {
  forbidAction?: string;
  scope?: string;
  presence?: Record<string, string>;
  arrangement?: string;
  primary?: string;
  actions?: string[];
  arguments?: Record<string, string>;
  confidence?: number;
}

interface Expectation {
  status: 'planned' | 'deferred';
  reason?: string;
  visible?: string[];
  retained?: string[];
  tree?: (string | null)[];
  actions?: {
    instanceId: string;
    action: string;
    params?: Record<string, unknown>;
  }[];
}

export interface Scenario {
  id: string;
  title: string;
  why: string;
  group: 'capability' | 'boundary' | 'compiler';
  input: PlanningInput;
  script: Script;
  expected: Expectation;
  minimumConfidence?: number;
}

function input(
  intent: string,
  options: {
    tree?: TilingNode[];
    variants?: Record<string, string>;
    columns?: number;
    rows?: number;
  } = {},
): PlanningInput {
  const instances = ['calendar', 'weather', 'tasks', 'map', 'journal'].map(
    (id) => {
      const vessel = vessels.find((v) => v.id === id);
      if (!vessel) throw new Error('Unknown fixture Vessel');
      return {
        instanceId: `${id}-main`,
        vesselId: id,
        variant: options.variants?.[id] ?? vessel.defaultVariant,
      };
    },
  );
  return {
    request: ChartRequestSchema.parse({
      type: 'chart_request',
      context: {
        layoutMode: 'tiling',
        chartDimensions: {
          columns: options.columns ?? 30,
          rows: options.rows ?? 18,
        },
        updateReasons: [{ type: 'user_intent', intent }],
      },
      instances,
      vessels,
      layout: {
        type: 'tiling',
        tree: options.tree ?? [
          'V:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
        instances,
      },
    }),
  };
}

const baseVisible = ['calendar-main', 'weather-main', 'tasks-main'];
const baseRetained = [
  'calendar-main',
  'weather-main',
  'tasks-main',
  'map-main',
  'journal-main',
];

export const scenarios: Scenario[] = [
  {
    id: 'preserve',
    title: 'Keep the current board',
    group: 'capability',
    why: 'A no-op must preserve identities and the exact tree without inventing actions.',
    input: input('Leave the board exactly as it is.'),
    script: {},
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [],
      tree: ['V:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
    },
  },
  {
    id: 'show-hidden',
    title: 'Show the existing map',
    group: 'capability',
    why: 'Showing an existing hidden Vessel must reuse its instance and state.',
    input: input('Show the map next to the current widgets.'),
    script: { presence: { 'map-main': 'visible' }, arrangement: 'row' },
    expected: {
      status: 'planned',
      visible: [...baseVisible, 'map-main'],
      retained: baseRetained,
      actions: [],
    },
  },
  {
    id: 'hide',
    title: 'Hide weather without deleting it',
    group: 'capability',
    why: 'Hiding must retain instance state for a later show operation.',
    input: input('Hide the weather, keep the rest.'),
    script: { presence: { 'weather-main': 'hidden' } },
    expected: {
      status: 'planned',
      visible: ['calendar-main', 'tasks-main'],
      retained: baseRetained,
      actions: [],
    },
  },
  {
    id: 'delete',
    title: 'Delete an instance explicitly',
    group: 'capability',
    why: 'Deleting and hiding have different lifecycle effects.',
    input: input('Delete the weather widget and its instance.'),
    script: { presence: { 'weather-main': 'absent' } },
    expected: {
      status: 'planned',
      visible: ['calendar-main', 'tasks-main'],
      retained: baseRetained.filter((id) => id !== 'weather-main'),
      actions: [],
    },
  },
  {
    id: 'focus',
    title: 'Give the calendar more space',
    group: 'capability',
    why: 'Emphasis needs one weighted tile, not duplicate references to one instance.',
    input: input(
      'Give the calendar two thirds of the board. Stack weather and tasks on the right.',
    ),
    script: { arrangement: 'focus', primary: 'calendar-main' },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [],
      tree: [
        'V:2,1',
        'ID:calendar-main',
        'H:1,1',
        'ID:weather-main',
        'ID:tasks-main',
      ],
    },
  },
  {
    id: 'column',
    title: 'Stack the visible widgets',
    group: 'capability',
    why: 'Code can compile spatial intent into a valid tree.',
    input: input('Stack the visible widgets vertically in equal rows.'),
    script: { arrangement: 'column' },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [],
      tree: ['H:1,1,1', 'ID:calendar-main', 'ID:weather-main', 'ID:tasks-main'],
    },
  },
  {
    id: 'variant',
    title: 'Switch weather to weekly',
    group: 'capability',
    why: 'Existing variants change through actions, not by overwriting the layout declaration.',
    input: input('Show the weekly forecast in the weather widget.'),
    script: { actions: ['weather-main/showWeekly'] },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [{ instanceId: 'weather-main', action: 'showWeekly' }],
    },
  },
  {
    id: 'enum-route',
    title: 'Select a saved map destination',
    group: 'capability',
    why: 'The real demo map exposes enum options, so Jev can select a valid destination without text generation.',
    input: input('Show directions to Studio Vortex HQ on the map.'),
    script: {
      presence: { 'map-main': 'visible' },
      actions: ['map-main/showRoute'],
      arguments: { 'param/0/destination': 'Studio Vortex HQ' },
    },
    expected: {
      status: 'planned',
      visible: [...baseVisible, 'map-main'],
      actions: [
        {
          instanceId: 'map-main',
          action: 'showRoute',
          params: { destination: 'Studio Vortex HQ' },
        },
      ],
    },
  },
  {
    id: 'quoted-location',
    title: 'Copy a quoted location',
    group: 'capability',
    why: 'Source-span selection can fill an open string without generating it.',
    input: input('Set the weather location to "Tokyo".'),
    script: {
      actions: ['weather-main/setLocation'],
      arguments: { 'param/0/location': 'Tokyo' },
    },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Tokyo' },
        },
      ],
    },
  },
  {
    id: 'two-actions',
    title: 'Configure weather then change its view',
    group: 'capability',
    why: 'The execution plan must preserve requested ordering.',
    input: input(
      'First set weather to "Tokyo", then show its hourly forecast.',
    ),
    script: {
      actions: ['weather-main/setLocation', 'weather-main/showHourly'],
      arguments: { 'param/0/location': 'Tokyo' },
    },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Tokyo' },
        },
        { instanceId: 'weather-main', action: 'showHourly' },
      ],
    },
  },
  {
    id: 'transition-sequence',
    title: 'Resolve actions after a variant transition',
    group: 'capability',
    why: 'showCurrent is unavailable initially; it becomes valid after showHourly.',
    input: input('Switch weather to hourly, then back to current conditions.'),
    script: {
      actions: ['weather-main/showHourly', 'weather-main/showCurrent'],
    },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [
        { instanceId: 'weather-main', action: 'showHourly' },
        { instanceId: 'weather-main', action: 'showCurrent' },
      ],
    },
  },
  {
    id: 'create-configure',
    title: 'Create and configure another weather instance',
    group: 'capability',
    why: 'An action must be able to target an instance introduced by the same layout.',
    input: input(
      'Add a second weather widget for "Paris". Keep everything else.',
    ),
    script: {
      presence: { 'weather-jev-1': 'visible' },
      actions: ['weather-jev-1/setLocation'],
      arguments: { 'param/0/location': 'Paris' },
    },
    expected: {
      status: 'planned',
      visible: [...baseVisible, 'weather-jev-1'],
      actions: [
        {
          instanceId: 'weather-jev-1',
          action: 'setLocation',
          params: { location: 'Paris' },
        },
      ],
    },
  },
  {
    id: 'compare',
    title: 'Compare two weather locations',
    group: 'capability',
    why: 'Different subjects need distinct instances and correctly paired arguments.',
    input: input(
      'Show only two weather widgets side by side: "Tokyo" on the left and "Paris" on the right. Reuse the existing weather widget for Tokyo.',
    ),
    script: {
      presence: {
        'calendar-main': 'hidden',
        'tasks-main': 'hidden',
        'weather-jev-1': 'visible',
      },
      arrangement: 'row',
      primary: 'weather-main',
      actions: ['weather-main/setLocation', 'weather-jev-1/setLocation'],
      arguments: { 'param/0/location': 'Tokyo', 'param/1/location': 'Paris' },
    },
    expected: {
      status: 'planned',
      visible: ['weather-main', 'weather-jev-1'],
      tree: ['V:1,1', 'ID:weather-main', 'ID:weather-jev-1'],
      actions: [
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
      ],
    },
  },
  {
    id: 'task',
    title: 'Add a task from a source span',
    group: 'capability',
    why: 'Content writes require exact parameters and must appear only once.',
    input: input('Add a task called "Buy milk".'),
    script: {
      actions: ['tasks-main/addTask'],
      arguments: { 'param/0/title': 'Buy milk' },
    },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [
        {
          instanceId: 'tasks-main',
          action: 'addTask',
          params: { title: 'Buy milk' },
        },
      ],
    },
  },
  {
    id: 'unquoted-location',
    title: 'Missing source candidates',
    group: 'boundary',
    why: 'A model cannot select Tokyo if the candidate extractor did not supply it.',
    input: input('Set the weather to Tokyo.'),
    script: { actions: ['weather-main/setLocation'] },
    expected: { status: 'deferred', reason: 'missing_candidates:0/location' },
  },
  {
    id: 'missing-enum',
    title: 'Destination outside the catalog',
    group: 'boundary',
    why: 'A supplied enum must not force a semantically wrong nearest match.',
    input: input('Show directions to the moon.'),
    script: {
      presence: { 'map-main': 'visible' },
      actions: ['map-main/showRoute'],
      arguments: { 'param/0/destination': '__missing__' },
    },
    expected: { status: 'deferred' },
  },
  {
    id: 'generate-content',
    title: 'New prose is outside this planner',
    group: 'boundary',
    why: 'Removing the chat reply does not remove actions that require generated content.',
    input: input('Write a new poem about the sea in my journal.'),
    script: { scope: 'unsupported' },
    expected: { status: 'deferred', reason: 'unsupported' },
  },
  {
    id: 'too-many-actions',
    title: 'Do not partially perform three writes',
    group: 'boundary',
    why: 'A bounded planner must defer the whole request rather than truncate it.',
    input: input('Add tasks "One", "Two", and "Three".'),
    script: { scope: 'unsupported' },
    expected: { status: 'deferred', reason: 'unsupported' },
  },
  {
    id: 'ambiguous',
    title: 'Unresolved reference',
    group: 'boundary',
    why: 'No supplied state identifies what the user means by that one.',
    input: input('Delete that one.'),
    script: { scope: 'ambiguous' },
    expected: { status: 'deferred', reason: 'ambiguous' },
  },
  {
    id: 'small-chart',
    title: 'A valid tree on a narrow Chart',
    group: 'capability',
    why: 'Maelstrom tiling intentionally ignores minSize. Valid structure does not prove the rendered content is readable.',
    input: input('Put calendar, weather, and tasks side by side.', {
      columns: 10,
      rows: 6,
    }),
    script: { arrangement: 'row' },
    expected: { status: 'planned', visible: baseVisible, actions: [] },
  },
  {
    id: 'bad-order',
    title: 'Reject an impossible action order',
    group: 'compiler',
    why: 'Independently valid choices can form an invalid sequence.',
    input: input('Switch weather back to current conditions.'),
    script: { actions: ['weather-main/showCurrent'] },
    expected: { status: 'deferred', reason: 'invalid_action_order' },
  },
  {
    id: 'absent-target',
    title: 'Exclude actions on uncreated instances',
    group: 'compiler',
    why: 'The action stage cannot select a target that the layout stage did not retain or create.',
    input: input('Show the weekly forecast.'),
    script: {
      actions: ['weather-main/showWeekly'],
      forbidAction: 'weather-jev-1/showWeekly',
    },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [{ instanceId: 'weather-main', action: 'showWeekly' }],
    },
  },
  {
    id: 'gap',
    title: 'Reject gaps in the action sequence',
    group: 'compiler',
    why: 'The second action cannot silently move into the first position.',
    input: input('Show the weekly forecast.'),
    script: { actions: ['none', 'weather-main/showWeekly'] },
    expected: { status: 'deferred', reason: 'action_sequence_gap' },
  },
  {
    id: 'uncertain',
    title: 'Exercise a confidence threshold',
    group: 'compiler',
    why: 'Threshold behavior can be verified without claiming the threshold is calibrated.',
    input: input('Show the weekly forecast.'),
    script: { confidence: 0.2 },
    minimumConfidence: 0.5,
    expected: { status: 'deferred', reason: 'low_confidence:scope' },
  },
];

const resize = input('');
resize.request = {
  ...resize.request,
  context: {
    ...resize.request.context,
    chartDimensions: { columns: 12, rows: 20 },
    updateReasons: [
      {
        type: 'chart_resize',
        previous: { columns: 30, rows: 18 },
        current: { columns: 12, rows: 20 },
      },
    ],
  },
};
resize.history = [
  {
    intent: 'Add a task called "Buy milk".',
    plan: {
      layout: {
        type: 'tiling',
        tree: ['ID:tasks-main'],
        instances: resize.request.instances,
      },
      executionPlan: [
        {
          instanceId: InstanceId('tasks-main'),
          action: ActionName(tasksVessel.variants.list.actions[0].name),
          params: { title: 'Buy milk' },
        },
      ],
    },
  },
];
scenarios.push({
  id: 'resize',
  title: 'Resize without replaying a task write',
  group: 'capability',
  why: 'A Chart resize contains no new content instruction. This prototype preserves the tiling tree with zero inference.',
  input: resize,
  script: {},
  expected: { status: 'planned', visible: baseVisible, actions: [] },
});

const followup = input('Now show its weekly forecast.');
followup.history = [
  {
    intent: 'Set weather to "Tokyo".',
    plan: {
      layout: {
        type: 'tiling',
        tree: ['ID:weather-main'],
        instances: followup.request.instances,
      },
      executionPlan: [
        {
          instanceId: InstanceId('weather-main'),
          action: ActionName(weatherVessel.variants.current.actions[0].name),
          params: { location: 'Tokyo' },
        },
      ],
    },
  },
];
scenarios.push({
  id: 'followup',
  title: 'Resolve a follow-up from structured history',
  group: 'capability',
  why: 'No assistant prose is needed to preserve the previous action target in context.',
  input: followup,
  script: { actions: ['weather-main/showWeekly'] },
  expected: {
    status: 'planned',
    visible: baseVisible,
    actions: [{ instanceId: 'weather-main', action: 'showWeekly' }],
  },
});

const runtimeOptions = input('Mark Buy milk as complete.');
runtimeOptions.request = {
  ...runtimeOptions.request,
  vessels: runtimeOptions.request.vessels.map((v) =>
    v.id === 'tasks'
      ? VesselSchema.parse(
          withActionOptions(tasksVessel, {
            checkTask: { title: ['Buy milk', 'Send invoice'] },
            removeTask: { title: ['Buy milk', 'Send invoice'] },
            uncheckTask: { title: ['Buy milk', 'Send invoice'] },
            addSubtask: { taskTitle: ['Buy milk', 'Send invoice'] },
          }),
        )
      : v,
  ),
};
scenarios.push({
  id: 'runtime-enum',
  title: 'Select an existing task from runtime options',
  group: 'capability',
  why: 'VesselOptionSync already publishes current titles as enums. The planner can use those values without quotes or a new protocol field.',
  input: runtimeOptions,
  script: {
    actions: ['tasks-main/checkTask'],
    arguments: { 'param/0/title': 'Buy milk' },
  },
  expected: {
    status: 'planned',
    visible: baseVisible,
    actions: [
      {
        instanceId: 'tasks-main',
        action: 'checkTask',
        params: { title: 'Buy milk' },
      },
    ],
  },
});

scenarios.push({
  id: 'tiny-resize',
  title: 'A tiny Chart still has a valid tree',
  group: 'capability',
  why: 'The tiling contract permits small allocations. This prototype does not claim to solve readability or responsive variant selection.',
  input: {
    request: {
      ...resize.request,
      context: {
        ...resize.request.context,
        chartDimensions: { columns: 2, rows: 2 },
        updateReasons: [
          {
            type: 'chart_resize',
            previous: { columns: 30, rows: 18 },
            current: { columns: 2, rows: 2 },
          },
        ],
      },
    },
  },
  script: {},
  expected: { status: 'planned', visible: baseVisible, actions: [] },
});

export const holdoutScenarios: Scenario[] = [
  {
    id: 'hold-preserve',
    title: 'Leave the workspace untouched',
    group: 'capability',
    why: 'A differently worded no-op must preserve every instance.',
    input: input('Everything looks right. Keep it this way.'),
    script: {},
    expected: {
      status: 'planned',
      visible: baseVisible,
      retained: baseRetained,
      actions: [],
    },
  },
  {
    id: 'hold-hide',
    title: 'Hide one of two visible widgets',
    group: 'capability',
    why: 'A changed initial board must not reveal unrelated hidden instances.',
    input: input('Take the forecast off screen and leave my calendar alone.', {
      tree: ['V', 'ID:calendar-main', 'ID:weather-main'],
    }),
    script: { presence: { 'weather-main': 'hidden' } },
    expected: {
      status: 'planned',
      visible: ['calendar-main'],
      retained: baseRetained,
      actions: [],
    },
  },
  {
    id: 'hold-show',
    title: 'Bring back a hidden checklist',
    group: 'capability',
    why: 'Reuse applies when a different Vessel starts hidden.',
    input: input('Bring back my task list beside the calendar.', {
      tree: ['ID:calendar-main'],
    }),
    script: { presence: { 'tasks-main': 'visible' } },
    expected: {
      status: 'planned',
      visible: ['calendar-main', 'tasks-main'],
      retained: baseRetained,
      actions: [],
    },
  },
  {
    id: 'hold-weather-variant',
    title: 'Return from weekly to current weather',
    group: 'capability',
    why: 'Action selection must depend on the actual starting variant.',
    input: input('Switch the weather widget back to current conditions.', {
      variants: { weather: 'weekly' },
    }),
    script: { actions: ['weather-main/showCurrent'] },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [{ instanceId: 'weather-main', action: 'showCurrent' }],
    },
  },
  {
    id: 'hold-calendar-variant',
    title: 'Switch the calendar to monthly',
    group: 'capability',
    why: 'Variant routing should transfer to another Vessel.',
    input: input('Switch my calendar from the week view to the month view.', {
      variants: { calendar: 'week' },
    }),
    script: { actions: ['calendar-main/showMonth'] },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [{ instanceId: 'calendar-main', action: 'showMonth' }],
    },
  },
  {
    id: 'hold-map-route',
    title: 'Find the route to a named workplace',
    group: 'capability',
    why: 'A route request should select an existing enum option under another phrasing.',
    input: input(
      'I need driving directions to Studio Vortex HQ. Bring up the map.',
    ),
    script: {
      presence: { 'map-main': 'visible' },
      actions: ['map-main/showRoute'],
      arguments: { 'param/0/destination': 'Studio Vortex HQ' },
    },
    expected: {
      status: 'planned',
      visible: [...baseVisible, 'map-main'],
      actions: [
        {
          instanceId: 'map-main',
          action: 'showRoute',
          params: { destination: 'Studio Vortex HQ' },
        },
      ],
    },
  },
  {
    id: 'hold-two-writes',
    title: 'Perform two distinct task writes',
    group: 'capability',
    why: 'Two calls to the same action must retain their distinct values and order.',
    input: input('Add "Review budget" to my tasks, then add "Book taxi".'),
    script: {
      actions: ['tasks-main/addTask', 'tasks-main/addTask'],
      arguments: {
        'param/0/title': 'Review budget',
        'param/1/title': 'Book taxi',
      },
    },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [
        {
          instanceId: 'tasks-main',
          action: 'addTask',
          params: { title: 'Review budget' },
        },
        {
          instanceId: 'tasks-main',
          action: 'addTask',
          params: { title: 'Book taxi' },
        },
      ],
    },
  },
  {
    id: 'hold-event',
    title: 'Pair an event title with its time',
    group: 'capability',
    why: 'Multiple string arguments must be selected by role rather than swapped.',
    input: input('Add "Dentist" to today’s calendar at "15:00".'),
    script: {
      actions: ['calendar-main/addEvent'],
      arguments: { 'param/0/title': 'Dentist', 'param/0/time': '15:00' },
    },
    expected: {
      status: 'planned',
      visible: baseVisible,
      actions: [
        {
          instanceId: 'calendar-main',
          action: 'addEvent',
          params: { title: 'Dentist', time: '15:00' },
        },
      ],
    },
  },
  {
    id: 'hold-new-instance',
    title: 'Add another weather view for Oslo',
    group: 'capability',
    why: 'New instance allocation should generalize beyond the development location.',
    input: input(
      'Keep my current board. Open one additional weather widget for "Oslo".',
    ),
    script: {
      presence: { 'weather-jev-1': 'visible' },
      actions: ['weather-jev-1/setLocation'],
      arguments: { 'param/0/location': 'Oslo' },
    },
    expected: {
      status: 'planned',
      visible: [...baseVisible, 'weather-jev-1'],
      actions: [
        {
          instanceId: 'weather-jev-1',
          action: 'setLocation',
          params: { location: 'Oslo' },
        },
      ],
    },
  },
  {
    id: 'hold-comparison',
    title: 'Configure two named comparison subjects',
    group: 'capability',
    why: 'A comparison must configure both the reused instance and the new one.',
    input: input(
      'Show only two weather panels side by side. Set the existing one on the left to "Oslo" and create one on the right for "Rome".',
    ),
    script: {
      presence: {
        'calendar-main': 'hidden',
        'tasks-main': 'hidden',
        'weather-jev-1': 'visible',
      },
      arrangement: 'row',
      primary: 'weather-main',
      actions: ['weather-main/setLocation', 'weather-jev-1/setLocation'],
      arguments: { 'param/0/location': 'Oslo', 'param/1/location': 'Rome' },
    },
    expected: {
      status: 'planned',
      visible: ['weather-main', 'weather-jev-1'],
      tree: ['V:1,1', 'ID:weather-main', 'ID:weather-jev-1'],
      actions: [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Oslo' },
        },
        {
          instanceId: 'weather-jev-1',
          action: 'setLocation',
          params: { location: 'Rome' },
        },
      ],
    },
  },
  {
    id: 'hold-stack',
    title: 'Rearrange two visible widgets on a tall Chart',
    group: 'capability',
    why: 'Rearranging visible instances must not create or reveal others.',
    input: input(
      'Keep exactly these visible widgets, but put them in equal rows from top to bottom.',
      {
        tree: ['V', 'ID:calendar-main', 'ID:tasks-main'],
        columns: 10,
        rows: 30,
      },
    ),
    script: { arrangement: 'column' },
    expected: {
      status: 'planned',
      visible: ['calendar-main', 'tasks-main'],
      tree: ['H:1,1', 'ID:calendar-main', 'ID:tasks-main'],
      actions: [],
    },
  },
  {
    id: 'hold-three-writes',
    title: 'Refuse three requested writes',
    group: 'boundary',
    why: 'A different three-item list must not be truncated to the first two.',
    input: input(
      'Create three tasks: "Call Sam", "Pay rent", and "Water plants".',
    ),
    script: { scope: 'unsupported' },
    expected: { status: 'deferred' },
  },
  {
    id: 'hold-unknown-vessel',
    title: 'Refuse an unavailable trading widget',
    group: 'boundary',
    why: 'A supported action vocabulary must not substitute an unrelated Vessel.',
    input: input('Open a stock trading widget and place a buy order.'),
    script: { scope: 'unsupported' },
    expected: { status: 'deferred' },
  },
  {
    id: 'hold-generated-content',
    title: 'Refuse new generated journal content',
    group: 'boundary',
    why: 'Removing the chat reply does not create a text-generation primitive for action parameters.',
    input: input('Write an original bedtime story about a fox in my journal.'),
    script: { scope: 'unsupported' },
    expected: { status: 'deferred' },
  },
  {
    id: 'hold-unquoted',
    title: 'Report missing candidates for a new title',
    group: 'boundary',
    why: 'The prototype must expose its extraction limit rather than invent a title.',
    input: input('Add a task to remember the passport.'),
    script: { actions: ['tasks-main/addTask'] },
    expected: { status: 'deferred' },
  },
  {
    id: 'hold-ambiguous',
    title: 'Refuse an unresolved destructive reference',
    group: 'boundary',
    why: 'An unspecified target must not be chosen from unrelated instances.',
    input: input('Delete the one I was thinking of.'),
    script: { scope: 'ambiguous' },
    expected: { status: 'deferred' },
  },
];

export function fixtureJudge(scenario: Scenario): Judge {
  return async (evaluation) => {
    const selections: Record<string, string> = {};
    if (Object.hasOwn(evaluation.questions, 'scope')) {
      const prepared = prepare(scenario.input);
      selections.scope = scenario.script.scope ?? 'supported';
      selections.arrangement = scenario.script.arrangement ?? 'preserve';
      selections.primary = scenario.script.primary ?? 'none';
      selections.actionCount = String(scenario.script.actions?.length ?? 0);
      for (const c of prepared.candidates.filter((c) => !c.fresh)) {
        const requested = scenario.script.presence?.[c.instanceId];
        selections[`presence/${c.instanceId}`] =
          requested === 'visible'
            ? 'show'
            : requested === 'hidden'
              ? 'hide'
              : requested === 'absent'
                ? 'delete'
                : 'unchanged';
      }
      for (const vessel of scenario.input.request.vessels) {
        selections[`create/${vessel.id}`] = String(
          prepared.candidates.filter(
            (c) =>
              c.fresh &&
              c.vesselId === vessel.id &&
              scenario.script.presence?.[c.instanceId] === 'visible',
          ).length,
        );
      }
    } else if (Object.hasOwn(evaluation.questions, 'action/0')) {
      if (
        scenario.script.forbidAction &&
        Object.values(evaluation.questions).some((q) =>
          Object.hasOwn(q.criteria, scenario.script.forbidAction ?? ''),
        )
      )
        throw new Error('Action choices include an uncreated instance');
      for (const key of Object.keys(evaluation.questions))
        selections[key] =
          scenario.script.actions?.[Number(key.split('/')[1])] ?? 'none';
    } else {
      for (const [key, question] of Object.entries(evaluation.questions)) {
        const intended = scenario.script.arguments?.[key];
        if (intended === '__missing__') selections[key] = 'missing';
        else {
          const found = Object.entries(question.criteria).find(
            ([, description]) => description === JSON.stringify(intended),
          );
          if (!found)
            throw new Error(
              `Scripted argument ${key} has no candidate: ${intended}`,
            );
          selections[key] = found[0];
        }
      }
    }
    return scriptedReply(
      evaluation,
      selections,
      scenario.script.confidence ?? 1,
    );
  };
}

export function score(
  scenario: Scenario,
  outcome: Outcome,
  strictReason = true,
): string[] {
  const failures: string[] = [];
  const expected = scenario.expected;
  if (outcome.status !== expected.status)
    return [`Expected ${expected.status}, received ${outcome.status}`];
  if (outcome.status === 'deferred') {
    if (strictReason && expected.reason && outcome.reason !== expected.reason)
      failures.push(`Expected ${expected.reason}, received ${outcome.reason}`);
    return failures;
  }
  const compare = (label: string, actual: unknown, wanted: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(wanted))
      failures.push(
        `${label}: expected ${JSON.stringify(wanted)}, received ${JSON.stringify(actual)}`,
      );
  };
  if (expected.visible)
    compare(
      'Visible instances',
      outcome.plan.layout.tree
        .map(tilingLeafInstanceId)
        .filter((id) => id !== null)
        .sort(),
      [...expected.visible].sort(),
    );
  const originalIds = scenario.input.request.instances.map((i) => i.instanceId);
  const retained = expected.retained ?? [
    ...new Set([...originalIds, ...(expected.visible ?? [])]),
  ];
  compare(
    'Retained instances',
    outcome.plan.layout.instances.map((i) => i.instanceId).sort(),
    [...retained].sort(),
  );
  if (expected.tree) compare('Tree', outcome.plan.layout.tree, expected.tree);
  if (expected.actions)
    compare('Ordered actions', outcome.plan.executionPlan, expected.actions);
  if (Object.keys(outcome.plan).sort().join(',') !== 'executionPlan,layout')
    failures.push('Plan contains fields beyond layout and executionPlan');
  for (const existing of scenario.input.request.instances) {
    const declaration = outcome.plan.layout.instances.find(
      (i) => i.instanceId === existing.instanceId,
    );
    if (declaration && declaration.variant !== existing.variant)
      failures.push(
        `Layout changed existing variant ${existing.instanceId} without executing actions`,
      );
  }
  return failures;
}
