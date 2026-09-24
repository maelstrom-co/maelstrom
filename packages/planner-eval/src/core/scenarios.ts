import type { LLMContextMessage } from '@maelstrom-co/engine';
import type { StageName } from '@maelstrom-co/planner-jev/_internal';
import { demoVessels } from '@maelstrom-co/planner-jev/_internal';
import {
  type ChartRequest,
  ChartRequestSchema,
  type Vessel,
  VesselSchema,
} from '@maelstrom-co/protocol';
import type { ArrangementRule } from './predicates.js';

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
  /** A reference tree the arrangement rules accept; not scored. */
  readonly tree?: readonly (string | null)[];
  /** Rules the shipped tree must satisfy, whichever arm or fallback wrote it. */
  readonly arrangement?: readonly ArrangementRule[];
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
  /**
   * Whether the request asks for an arrangement (`true`) or is a control
   * that should leave the arrangement alone (`false`), for counting a
   * spatial gate's false positives and negatives. Untagged scenarios are
   * not counted.
   */
  readonly spatial?: boolean;
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

const PAIR_TREE = ['V', 'ID:calendar-main', 'ID:map-main'];
const TRIO_TREE = [
  'V:1,1,1',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:map-main',
];
const TRIO_VISIBLE = ['calendar-main', 'weather-main', 'map-main'];

const STUDIO_ROUTE_TURN: readonly LLMContextMessage[] = [
  {
    role: 'user',
    content: 'Show me the route to Studio Vortex HQ on the map.',
  },
  { role: 'assistant', content: 'The route is set to Studio Vortex HQ.' },
];

/** Explicit arrangement requests; any arm, fallback included, may satisfy them. */
const arrangements: Scenario[] = [
  planned(
    'swap',
    'Swap two widgets',
    'Swap the calendar and the map.',
    {
      visible: ['calendar-main', 'map-main'],
      actions: [],
      tree: ['V', 'ID:map-main', 'ID:calendar-main'],
      arrangement: [{ kind: 'leftOf', a: 'map-main', b: 'calendar-main' }],
    },
    { tree: PAIR_TREE },
  ),
  planned(
    'big-right',
    'A big instance on the right',
    'Show the map on the right taking most of the screen, with the calendar on the left in a smaller column.',
    {
      visible: ['calendar-main', 'map-main'],
      actions: [],
      tree: ['V:1,2', 'ID:calendar-main', 'ID:map-main'],
      arrangement: [
        { kind: 'leftOf', a: 'calendar-main', b: 'map-main' },
        { kind: 'dominant', id: 'map-main', minShare: 0.55 },
      ],
    },
    { tree: PAIR_TREE },
  ),
  planned(
    'top-and-pair',
    'A full-width row above a split',
    'Put the calendar full width at the top, and beneath it the weather and the map side by side, all the same height.',
    {
      visible: TRIO_VISIBLE,
      actions: [],
      tree: ['H', 'ID:calendar-main', 'V', 'ID:weather-main', 'ID:map-main'],
      arrangement: [
        { kind: 'spansFullWidth', id: 'calendar-main' },
        { kind: 'above', a: 'calendar-main', b: 'weather-main' },
        { kind: 'above', a: 'calendar-main', b: 'map-main' },
        { kind: 'sideBySide', ids: ['weather-main', 'map-main'] },
        // Equal heights make the full-width row twice the area of each half.
        {
          kind: 'weightRatio',
          a: 'calendar-main',
          b: 'weather-main',
          min: 1.6,
          max: 2.5,
        },
      ],
    },
    { tree: TRIO_TREE },
  ),
  planned(
    'bottom-strip',
    'A thin strip along an edge',
    'Make the weather a thin strip along the bottom, with the calendar and map above it.',
    {
      visible: TRIO_VISIBLE,
      actions: [],
      tree: [
        'H:3,1',
        'V',
        'ID:calendar-main',
        'ID:map-main',
        'ID:weather-main',
      ],
      arrangement: [
        { kind: 'spansFullWidth', id: 'weather-main' },
        { kind: 'below', a: 'weather-main', b: 'calendar-main' },
        { kind: 'below', a: 'weather-main', b: 'map-main' },
        { kind: 'sideBySide', ids: ['calendar-main', 'map-main'] },
        {
          kind: 'weightRatio',
          a: 'weather-main',
          b: 'calendar-main',
          min: 0,
          max: 0.75,
        },
        {
          kind: 'weightRatio',
          a: 'weather-main',
          b: 'map-main',
          min: 0,
          max: 0.75,
        },
      ],
    },
    { tree: TRIO_TREE },
  ),
  planned(
    'bottom-strip-keep-row',
    'A thin strip along the bottom of a row',
    'Make the weather a thin strip along the bottom.',
    {
      visible: TRIO_VISIBLE,
      actions: [],
      tree: [
        'H:3,1',
        'V',
        'ID:calendar-main',
        'ID:map-main',
        'ID:weather-main',
      ],
      arrangement: [
        { kind: 'spansFullWidth', id: 'weather-main' },
        { kind: 'below', a: 'weather-main', b: 'calendar-main' },
        { kind: 'below', a: 'weather-main', b: 'map-main' },
        { kind: 'leftOf', a: 'calendar-main', b: 'map-main' },
        {
          kind: 'weightRatio',
          a: 'weather-main',
          b: 'calendar-main',
          min: 0,
          max: 0.75,
        },
      ],
    },
    { tree: TRIO_TREE },
  ),
  planned(
    'bottom-strip-four-nested',
    'A thin strip along the bottom of a nested layout',
    'Make the weather a thin strip along the bottom.',
    {
      visible: ['calendar-main', 'tasks-main', 'map-main', 'weather-main'],
      actions: [],
      tree: [
        'H:3,1',
        'V:2,1',
        'H',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:map-main',
        'ID:weather-main',
      ],
      arrangement: [
        { kind: 'spansFullWidth', id: 'weather-main' },
        { kind: 'below', a: 'weather-main', b: 'calendar-main' },
        { kind: 'below', a: 'weather-main', b: 'tasks-main' },
        { kind: 'below', a: 'weather-main', b: 'map-main' },
        { kind: 'above', a: 'calendar-main', b: 'tasks-main' },
        { kind: 'leftOf', a: 'calendar-main', b: 'map-main' },
        { kind: 'leftOf', a: 'tasks-main', b: 'map-main' },
        {
          kind: 'weightRatio',
          a: 'weather-main',
          b: 'calendar-main',
          min: 0,
          max: 1,
        },
      ],
    },
    {
      tree: ['V:2,1', 'H', 'ID:calendar-main', 'ID:tasks-main', 'ID:map-main'],
      columns: 36,
      rows: 16,
      variants: { calendar: 'day' },
    },
  ),
  planned(
    'half-of-left-column-nested',
    'Half of a nested column',
    'Give the tasks half of the left column.',
    {
      visible: ['calendar-main', 'tasks-main', 'map-main', 'weather-main'],
      actions: [],
      tree: [
        'H:3,1',
        'V',
        'H',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:map-main',
        'ID:weather-main',
      ],
      arrangement: [
        { kind: 'stacked', ids: ['calendar-main', 'tasks-main'] },
        { kind: 'leftOf', a: 'calendar-main', b: 'map-main' },
        { kind: 'leftOf', a: 'tasks-main', b: 'map-main' },
        { kind: 'spansFullWidth', id: 'weather-main' },
        {
          kind: 'weightRatio',
          a: 'tasks-main',
          b: 'calendar-main',
          min: 0.8,
          max: 1.25,
        },
      ],
    },
    {
      tree: [
        'H:4,1',
        'V',
        'H',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:map-main',
        'ID:weather-main',
      ],
      columns: 36,
      rows: 16,
      variants: { calendar: 'day' },
    },
  ),
  planned(
    'full-height-column-keep-row',
    'A full-height column beside a kept row',
    'Move the calendar into a full-height column on the left while keeping the top row layout as it is.',
    {
      visible: [
        'calendar-main',
        'tasks-main',
        'journal-main',
        'map-main',
        'weather-main',
      ],
      actions: [],
      tree: [
        'V:1,3',
        'ID:calendar-main',
        'H:3,1',
        'V:2,1,2',
        'ID:tasks-main',
        'ID:journal-main',
        'ID:map-main',
        'ID:weather-main',
      ],
      arrangement: [
        { kind: 'spansFullHeight', id: 'calendar-main' },
        { kind: 'sideBySide', ids: ['tasks-main', 'journal-main', 'map-main'] },
        { kind: 'below', a: 'weather-main', b: 'tasks-main' },
        { kind: 'below', a: 'weather-main', b: 'journal-main' },
        { kind: 'below', a: 'weather-main', b: 'map-main' },
      ],
    },
    {
      tree: [
        'H:3,1',
        'V:2,2,1,2',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:journal-main',
        'ID:map-main',
        'ID:weather-main',
      ],
      columns: 36,
      rows: 16,
      variants: { calendar: 'day' },
    },
  ),
  planned(
    'narrow-column-pair',
    'A narrow column of two',
    'Put the calendar and tasks in a narrow column.',
    {
      visible: [
        'calendar-main',
        'tasks-main',
        'journal-main',
        'map-main',
        'weather-main',
      ],
      actions: [],
      tree: [
        'V:1,2,2',
        'H',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:journal-main',
        'H',
        'ID:map-main',
        'ID:weather-main',
      ],
      arrangement: [
        { kind: 'stacked', ids: ['calendar-main', 'tasks-main'] },
        { kind: 'leftOf', a: 'calendar-main', b: 'map-main' },
        // No rule reads a width share: a calendar sharing a column as wide as the journal's has half its area.
        {
          kind: 'weightRatio',
          a: 'calendar-main',
          b: 'journal-main',
          min: 0,
          max: 0.4,
        },
      ],
    },
    {
      tree: [
        'V:3,2,2,4',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:journal-main',
        'H',
        'ID:map-main',
        'ID:weather-main',
      ],
      columns: 36,
      rows: 16,
      variants: { calendar: 'day' },
    },
  ),
  planned(
    'reorder-end',
    'Move one widget to the end of the row',
    'Move the calendar to the end of the row, after the tasks.',
    {
      visible: BASE_VISIBLE,
      actions: [],
      tree: ['V:1,1,1', 'ID:weather-main', 'ID:tasks-main', 'ID:calendar-main'],
      arrangement: [
        {
          kind: 'order',
          ids: ['weather-main', 'tasks-main', 'calendar-main'],
          axis: 'x',
        },
        {
          kind: 'sideBySide',
          ids: ['weather-main', 'tasks-main', 'calendar-main'],
        },
      ],
    },
  ),
  planned(
    'reverse-order',
    'Reverse the row',
    'Reverse the order of the widgets.',
    {
      visible: BASE_VISIBLE,
      actions: [],
      tree: ['V:1,1,1', 'ID:tasks-main', 'ID:weather-main', 'ID:calendar-main'],
      arrangement: [
        {
          kind: 'order',
          ids: ['tasks-main', 'weather-main', 'calendar-main'],
          axis: 'x',
        },
      ],
    },
  ),
  planned(
    'two-columns-left',
    'Two columns with a dominant left one',
    'Arrange two columns: a wide left column with the tasks, and a narrower right column with the calendar above the weather.',
    {
      visible: BASE_VISIBLE,
      actions: [],
      tree: [
        'V:3,2',
        'ID:tasks-main',
        'H',
        'ID:calendar-main',
        'ID:weather-main',
      ],
      arrangement: [
        { kind: 'leftOf', a: 'tasks-main', b: 'calendar-main' },
        { kind: 'leftOf', a: 'tasks-main', b: 'weather-main' },
        { kind: 'spansFullHeight', id: 'tasks-main' },
        { kind: 'above', a: 'calendar-main', b: 'weather-main' },
        { kind: 'dominant', id: 'tasks-main', minShare: 0.5 },
      ],
    },
  ),
  planned(
    'grid-2x2',
    'A two by two grid',
    'Show the calendar, weather, tasks and map in a 2x2 grid: calendar and weather on top, tasks and map below.',
    {
      visible: [...BASE_VISIBLE, 'map-main'],
      actions: [],
      tree: [
        'H',
        'V',
        'ID:calendar-main',
        'ID:weather-main',
        'V',
        'ID:tasks-main',
        'ID:map-main',
      ],
      arrangement: [
        { kind: 'sideBySide', ids: ['calendar-main', 'weather-main'] },
        { kind: 'sideBySide', ids: ['tasks-main', 'map-main'] },
        { kind: 'order', ids: ['calendar-main', 'tasks-main'], axis: 'y' },
        { kind: 'order', ids: ['calendar-main', 'map-main'], axis: 'y' },
        { kind: 'order', ids: ['weather-main', 'tasks-main'], axis: 'y' },
        { kind: 'order', ids: ['weather-main', 'map-main'], axis: 'y' },
        ...equalAreas('calendar-main', [
          'weather-main',
          'tasks-main',
          'map-main',
        ]),
      ],
    },
  ),
  planned(
    'weather-under-calendar',
    'Put one widget under another',
    'Put the weather under the calendar.',
    {
      visible: BASE_VISIBLE,
      actions: [],
      tree: [
        'V:1,1',
        'H',
        'ID:calendar-main',
        'ID:weather-main',
        'ID:tasks-main',
      ],
      arrangement: [{ kind: 'below', a: 'weather-main', b: 'calendar-main' }],
    },
  ),
  planned(
    'map-full-width-bottom',
    'A full-width widget along the bottom',
    'Show the map full width along the bottom, under the other widgets.',
    {
      visible: [...BASE_VISIBLE, 'map-main'],
      actions: [],
      tree: [
        'H',
        'V:1,1,1',
        'ID:calendar-main',
        'ID:weather-main',
        'ID:tasks-main',
        'ID:map-main',
      ],
      arrangement: [
        { kind: 'spansFullWidth', id: 'map-main' },
        { kind: 'below', a: 'map-main', b: 'calendar-main' },
        { kind: 'below', a: 'map-main', b: 'weather-main' },
        { kind: 'below', a: 'map-main', b: 'tasks-main' },
      ],
    },
  ),
  planned(
    'preserve-resize',
    'Keep a custom arrangement through a resize',
    'Keep this arrangement exactly as it is.',
    unchanged({ visible: BASE_VISIBLE, actions: [] }),
    {
      tree: [
        'V:2,1',
        'ID:calendar-main',
        'H',
        'ID:weather-main',
        'ID:tasks-main',
      ],
      resizeFrom: { columns: 24, rows: 18 },
    },
  ),
  // Composed-stage-only arrangements: each nests a split that no
  // `layoutPreset` menu option offers, so only a composed layout stage (or a
  // hand-off to the LLM) can produce them.
  planned(
    'narrow-pair-stacked-triple',
    'A narrow left pair beside a stacked right triple',
    'Put the calendar and tasks in a narrow column on the left. On the right, stack the map, weather and journal, and give the journal half the height.',
    {
      visible: [...BASE_VISIBLE, 'map-main', 'journal-main'],
      actions: [],
      tree: [
        'V:1,4',
        'H',
        'ID:calendar-main',
        'ID:tasks-main',
        'H:1,1,2',
        'ID:map-main',
        'ID:weather-main',
        'ID:journal-main',
      ],
      arrangement: [
        { kind: 'stacked', ids: ['calendar-main', 'tasks-main'] },
        {
          kind: 'stacked',
          ids: ['map-main', 'weather-main', 'journal-main'],
        },
        // Only two cross-stack pairs share rows for any split of the two
        // stacks' weights, not only the reference proportions: the
        // top-of-left and top-of-right always both start at y=0, and the
        // bottom-of-left and bottom-of-right always both end at the Chart's
        // bottom edge. The middle-right item (weather) has no such
        // guarantee, so it is left unchecked by `leftOf`.
        { kind: 'leftOf', a: 'calendar-main', b: 'map-main' },
        { kind: 'leftOf', a: 'tasks-main', b: 'journal-main' },
        {
          kind: 'order',
          ids: ['map-main', 'weather-main', 'journal-main'],
          axis: 'y',
        },
        {
          kind: 'weightRatio',
          a: 'journal-main',
          b: 'map-main',
          min: 1.6,
          max: 2.5,
        },
        {
          kind: 'weightRatio',
          a: 'journal-main',
          b: 'weather-main',
          min: 1.6,
          max: 2.5,
        },
        {
          kind: 'weightRatio',
          a: 'calendar-main',
          b: 'map-main',
          min: 0,
          max: 0.75,
        },
      ],
    },
    {
      tree: [
        'V:1,1,1,1,1',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:map-main',
        'ID:weather-main',
        'ID:journal-main',
      ],
    },
  ),
  planned(
    'journal-half-of-right-column',
    'A stated proportion within an existing column',
    'Make the journal take half of the right column.',
    {
      visible: ['calendar-main', 'map-main', 'weather-main', 'journal-main'],
      actions: [],
      tree: [
        'V',
        'ID:calendar-main',
        'H:1,1,2',
        'ID:map-main',
        'ID:weather-main',
        'ID:journal-main',
      ],
      arrangement: [
        { kind: 'leftOf', a: 'calendar-main', b: 'journal-main' },
        {
          kind: 'stacked',
          ids: ['map-main', 'weather-main', 'journal-main'],
        },
        {
          kind: 'order',
          ids: ['map-main', 'weather-main', 'journal-main'],
          axis: 'y',
        },
        {
          kind: 'weightRatio',
          a: 'journal-main',
          b: 'map-main',
          min: 1.6,
          max: 2.5,
        },
        {
          kind: 'weightRatio',
          a: 'journal-main',
          b: 'weather-main',
          min: 1.6,
          max: 2.5,
        },
        { kind: 'spansFullHeight', id: 'calendar-main' },
      ],
    },
    {
      tree: [
        'V',
        'ID:calendar-main',
        'H:1,1,1',
        'ID:map-main',
        'ID:weather-main',
        'ID:journal-main',
      ],
    },
  ),
  planned(
    'edge-columns-nested-middle',
    'Two edge columns flanking a stacked middle pair',
    'Weather on the left, calendar above tasks in the middle, map on the right.',
    {
      visible: [...BASE_VISIBLE, 'map-main'],
      actions: [],
      tree: [
        'V:1,1,1',
        'ID:weather-main',
        'H',
        'ID:calendar-main',
        'ID:tasks-main',
        'ID:map-main',
      ],
      arrangement: [
        { kind: 'leftOf', a: 'weather-main', b: 'calendar-main' },
        { kind: 'leftOf', a: 'weather-main', b: 'tasks-main' },
        { kind: 'leftOf', a: 'calendar-main', b: 'map-main' },
        { kind: 'leftOf', a: 'tasks-main', b: 'map-main' },
        { kind: 'above', a: 'calendar-main', b: 'tasks-main' },
        { kind: 'spansFullHeight', id: 'weather-main' },
        { kind: 'spansFullHeight', id: 'map-main' },
      ],
    },
    {
      tree: [
        'V:1,1,1,1',
        'ID:calendar-main',
        'ID:weather-main',
        'ID:tasks-main',
        'ID:map-main',
      ],
    },
  ),
].map(spatial);

/** Requests that should leave the arrangement alone: content edits, view changes and an added widget. */
const controls: Scenario[] = [
  planned(
    'ctl-add-task',
    'A content edit keeps the layout',
    'Add a task called "Call the bank".',
    unchanged({ visible: BASE_VISIBLE, actions: [addTask('Call the bank')] }),
  ),
  planned(
    'ctl-set-location',
    'A setting change keeps the layout',
    'Set the weather location to "Lisbon".',
    unchanged({
      visible: BASE_VISIBLE,
      actions: [setLocation('weather-main', 'Lisbon')],
    }),
  ),
  planned(
    'ctl-calendar-week',
    'A view change keeps the layout',
    'Switch the calendar to the week view.',
    unchanged({
      visible: BASE_VISIBLE,
      actions: [{ instanceId: 'calendar-main', action: 'showWeek' }],
    }),
  ),
  planned(
    'ctl-weather-hourly',
    'Another view change keeps the layout',
    'Show the hourly forecast in the weather widget.',
    unchanged({
      visible: BASE_VISIBLE,
      actions: [{ instanceId: 'weather-main', action: 'showHourly' }],
    }),
  ),
  planned(
    'ctl-add-event',
    'An event with a time keeps the layout',
    'Add "Lunch with Ana" to today’s calendar at "12:30".',
    unchanged({
      visible: BASE_VISIBLE,
      actions: [
        {
          instanceId: 'calendar-main',
          action: 'addEvent',
          params: { title: 'Lunch with Ana', time: '12:30' },
        },
      ],
    }),
  ),
  planned(
    'ctl-also-journal',
    'Adding a widget keeps the board balanced',
    'Also show my journal.',
    {
      visible: [...BASE_VISIBLE, 'journal-main'],
      retained: BASE_RETAINED,
      actions: [],
      tree: [
        'V:1,1,1,1',
        'ID:calendar-main',
        'ID:weather-main',
        'ID:tasks-main',
        'ID:journal-main',
      ],
      arrangement: balanced('calendar-main', [
        'weather-main',
        'tasks-main',
        'journal-main',
      ]),
    },
  ),
].map(control);

const development: Scenario[] = [
  control(
    planned(
      'preserve',
      'Keep the current board',
      'Leave the board exactly as it is.',
      unchanged({
        visible: BASE_VISIBLE,
        actions: [],
        tree: BASE_TREE,
      }),
    ),
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
  spatial(
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
        arrangement: [
          { kind: 'sideBySide', ids: ['calendar-main', 'weather-main'] },
        ],
      },
    ),
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
  spatial(
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
        arrangement: [
          { kind: 'leftOf', a: 'calendar-main', b: 'weather-main' },
          { kind: 'leftOf', a: 'calendar-main', b: 'tasks-main' },
          { kind: 'stacked', ids: ['weather-main', 'tasks-main'] },
          { kind: 'dominant', id: 'calendar-main', minShare: 0.6 },
        ],
      },
    ),
  ),
  spatial(
    planned(
      'column',
      'Stack the visible widgets',
      'Stack the visible widgets vertically in equal rows.',
      {
        visible: BASE_VISIBLE,
        actions: [],
        tree: [
          'H:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
        arrangement: [
          {
            kind: 'stacked',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
          },
          ...equalAreas('calendar-main', ['weather-main', 'tasks-main']),
        ],
      },
    ),
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
    'enum-route-short-name',
    'Select a saved map destination by a short name',
    'Show me the map and display a route from home to the studio.',
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
    'enum-route-description',
    'Select a saved map destination by what it is',
    'Show me the route to the coffee place on the map.',
    {
      visible: [...BASE_VISIBLE, 'map-main'],
      actions: [
        {
          instanceId: 'map-main',
          action: 'showRoute',
          params: { destination: 'Ritual Coffee' },
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
  spatial(
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
        arrangement: [
          { kind: 'leftOf', a: 'weather-main', b: 'weather-jev-1' },
        ],
      },
    ),
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
  spatial(
    deferred(
      'small-chart',
      'No layout gives every widget its minimum size',
      'Put calendar, weather, and tasks side by side.',
      'jevLayout',
      { columns: 10, rows: 6 },
    ),
  ),
  ...arrangements,
  ...controls,
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
  routeAfter(
    'history-route-gym-after-studio',
    'Route to the place the latest request names, not an earlier one',
    'Now show me the route to the gym.',
    STUDIO_ROUTE_TURN,
    'Mission High Fitness',
  ),
  routeAfter(
    'history-route-studio-after-gym',
    'Route to the studio after a route to the gym',
    'Now show me the route to the studio.',
    [
      { role: 'user', content: 'Show me the route to the gym on the map.' },
      {
        role: 'assistant',
        content: 'The route is set to Mission High Fitness.',
      },
    ],
    'Studio Vortex HQ',
  ),
  routeAfter(
    'history-route-gym-voice-paraphrase',
    'Route to the gym after a studio turn, as the voice agent words it',
    'Show the map and display a route to the gym by using the saved destination "Mission High Fitness". If an origin is needed but not configurable, use the default origin and just show the route to Mission High Fitness.',
    [
      {
        role: 'user',
        content:
          'Show the map and display a route to the studio, using the saved destination "Studio Vortex HQ". If possible, route from Home; if origin cannot be specified, use the default routing origin and just show the route to Studio Vortex HQ.',
      },
      {
        role: 'assistant',
        content:
          'The map is on the right, and the route is set to Studio Vortex HQ using the default origin.',
      },
    ],
    'Mission High Fitness',
    'overview',
  ),
  routeAfter(
    'history-route-back-reference',
    'Resolve a destination the latest request refers back to',
    'Show me the route there again.',
    [
      ...STUDIO_ROUTE_TURN,
      { role: 'user', content: 'Now show all my saved places on the map.' },
      {
        role: 'assistant',
        content: 'The map now shows all your saved places.',
      },
    ],
    'Studio Vortex HQ',
    'overview',
  ),
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
  control(
    planned(
      'hold-preserve',
      'Leave the workspace untouched',
      'Everything looks right. Keep it this way.',
      unchanged({
        visible: BASE_VISIBLE,
        retained: BASE_RETAINED,
        actions: [],
      }),
    ),
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
  spatial(
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
        arrangement: [
          { kind: 'leftOf', a: 'weather-main', b: 'weather-jev-1' },
        ],
      },
    ),
  ),
  spatial(
    planned(
      'hold-stack',
      'Rearrange two visible widgets on a tall Chart',
      'Keep exactly these visible widgets, but put them in equal rows from top to bottom.',
      {
        visible: ['calendar-main', 'tasks-main'],
        tree: ['H', 'ID:calendar-main', 'ID:tasks-main'],
        actions: [],
        arrangement: [
          { kind: 'stacked', ids: ['calendar-main', 'tasks-main'] },
          ...equalAreas('calendar-main', ['tasks-main']),
        ],
      },
      {
        tree: ['V', 'ID:calendar-main', 'ID:tasks-main'],
        columns: 10,
        rows: 30,
      },
    ),
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
  ...[
    planned(
      'hold-arr-swap',
      'Trade places between two widgets',
      'Swap the weather and the tasks.',
      {
        visible: BASE_VISIBLE,
        actions: [],
        tree: [
          'V:1,1,1',
          'ID:calendar-main',
          'ID:tasks-main',
          'ID:weather-main',
        ],
        arrangement: [
          {
            kind: 'order',
            ids: ['calendar-main', 'tasks-main', 'weather-main'],
            axis: 'x',
          },
        ],
      },
    ),
    planned(
      'hold-arr-sidebar',
      'A narrow sidebar beside a stacked pair',
      'Put the tasks in a narrow column on the left, with the calendar above the weather on the right.',
      {
        visible: BASE_VISIBLE,
        actions: [],
        tree: [
          'V:1,2',
          'ID:tasks-main',
          'H',
          'ID:calendar-main',
          'ID:weather-main',
        ],
        arrangement: [
          { kind: 'leftOf', a: 'tasks-main', b: 'calendar-main' },
          { kind: 'leftOf', a: 'tasks-main', b: 'weather-main' },
          { kind: 'spansFullHeight', id: 'tasks-main' },
          { kind: 'above', a: 'calendar-main', b: 'weather-main' },
        ],
      },
    ),
    planned(
      'hold-arr-banner',
      'A banner across the top',
      'Show the map as a wide banner across the top, with the other widgets underneath.',
      {
        visible: [...BASE_VISIBLE, 'map-main'],
        actions: [],
        tree: [
          'H:1,2',
          'ID:map-main',
          'V:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
        arrangement: [
          { kind: 'spansFullWidth', id: 'map-main' },
          { kind: 'above', a: 'map-main', b: 'calendar-main' },
          { kind: 'above', a: 'map-main', b: 'weather-main' },
          { kind: 'above', a: 'map-main', b: 'tasks-main' },
        ],
      },
    ),
    planned(
      'hold-arr-focus',
      'One widget takes most of the board',
      'Make the calendar the main focus, taking up most of the screen.',
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
        arrangement: [{ kind: 'dominant', id: 'calendar-main', minShare: 0.5 }],
      },
    ),
  ].map(spatial),
  ...[
    planned(
      'hold-ctl-task',
      'Add a task without touching the layout',
      'Put "Renew passport" on my task list.',
      unchanged({
        visible: BASE_VISIBLE,
        actions: [addTask('Renew passport')],
      }),
    ),
    planned(
      'hold-ctl-weekly',
      'Change the forecast view without touching the layout',
      'Switch the forecast to the weekly view.',
      unchanged({
        visible: BASE_VISIBLE,
        actions: [{ instanceId: 'weather-main', action: 'showWeekly' }],
      }),
    ),
    planned(
      'hold-ctl-location',
      'Change the forecast city without touching the layout',
      'Change the forecast city to "Madrid".',
      unchanged({
        visible: BASE_VISIBLE,
        actions: [setLocation('weather-main', 'Madrid')],
      }),
    ),
  ].map(control),
  ...[
    planned(
      'hold-inner-third-of-column',
      'Resize one widget to a third of its column',
      'Give the calendar only a third of the right-hand column and let the tasks fill the rest.',
      {
        visible: ['map-main', 'calendar-main', 'tasks-main'],
        actions: [],
        tree: [
          'V:1,1',
          'ID:map-main',
          'H:1,2',
          'ID:calendar-main',
          'ID:tasks-main',
        ],
        arrangement: [
          { kind: 'spansFullHeight', id: 'map-main' },
          { kind: 'leftOf', a: 'map-main', b: 'calendar-main' },
          { kind: 'leftOf', a: 'map-main', b: 'tasks-main' },
          { kind: 'above', a: 'calendar-main', b: 'tasks-main' },
          { kind: 'stacked', ids: ['calendar-main', 'tasks-main'] },
          ratioNear('calendar-main', 'tasks-main', 1 / 2),
        ],
      },
      {
        tree: [
          'V:1,1',
          'ID:map-main',
          'H:1,1',
          'ID:calendar-main',
          'ID:tasks-main',
        ],
      },
    ),
    planned(
      'hold-inner-two-thirds-of-row',
      'Move one widget to a strip and size one within the row above',
      'Put the map along the bottom as a full-width strip. In the row above it, the calendar should take two thirds of the row, with the weather and the tasks sharing the rest.',
      {
        visible: [...BASE_VISIBLE, 'map-main'],
        actions: [],
        tree: [
          'H:2,1',
          'V:4,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:map-main',
        ],
        arrangement: [
          { kind: 'spansFullWidth', id: 'map-main' },
          { kind: 'above', a: 'calendar-main', b: 'map-main' },
          { kind: 'above', a: 'weather-main', b: 'map-main' },
          { kind: 'above', a: 'tasks-main', b: 'map-main' },
          {
            kind: 'sideBySide',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
          },
          ratioNear('calendar-main', 'weather-main', 4),
          ratioNear('calendar-main', 'tasks-main', 4),
        ],
      },
    ),
    planned(
      'hold-inner-twice-as-tall',
      'Make one widget twice as tall as its column neighbours',
      'In the left column, make the tasks twice as tall as each of the other two.',
      {
        visible: [...BASE_VISIBLE, 'map-main'],
        actions: [],
        tree: [
          'V:1,1',
          'H:1,1,2',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:map-main',
        ],
        arrangement: [
          { kind: 'spansFullHeight', id: 'map-main' },
          { kind: 'leftOf', a: 'tasks-main', b: 'map-main' },
          {
            kind: 'order',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
            axis: 'y',
          },
          {
            kind: 'stacked',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
          },
          ratioNear('tasks-main', 'calendar-main', 2),
          ratioNear('tasks-main', 'weather-main', 2),
        ],
      },
      {
        tree: [
          'V:1,1',
          'H:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:map-main',
        ],
      },
    ),
    planned(
      'hold-inner-smaller-of-pair',
      'Regroup into a banner over a pair and shrink one of the pair',
      'Put the calendar across the top, with the weather and the tasks side by side underneath it. Make the weather the smaller of those two.',
      {
        visible: BASE_VISIBLE,
        actions: [],
        tree: [
          'H',
          'ID:calendar-main',
          'V:1,2',
          'ID:weather-main',
          'ID:tasks-main',
        ],
        arrangement: [
          { kind: 'spansFullWidth', id: 'calendar-main' },
          { kind: 'above', a: 'calendar-main', b: 'weather-main' },
          { kind: 'above', a: 'calendar-main', b: 'tasks-main' },
          { kind: 'sideBySide', ids: ['weather-main', 'tasks-main'] },
          {
            kind: 'weightRatio',
            a: 'weather-main',
            b: 'tasks-main',
            min: 0,
            max: 0.75,
          },
        ],
      },
    ),
    planned(
      'hold-inner-quarter-of-column',
      'Shrink one widget to a quarter of its column',
      'Shrink the weather to a quarter of the right column; the calendar and the tasks can split what is left.',
      {
        visible: [...BASE_VISIBLE, 'map-main'],
        actions: [],
        tree: [
          'V:2,1',
          'ID:map-main',
          'H:3,2,3',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
        arrangement: [
          { kind: 'spansFullHeight', id: 'map-main' },
          { kind: 'leftOf', a: 'map-main', b: 'calendar-main' },
          { kind: 'leftOf', a: 'map-main', b: 'weather-main' },
          { kind: 'leftOf', a: 'map-main', b: 'tasks-main' },
          {
            kind: 'order',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
            axis: 'y',
          },
          {
            kind: 'stacked',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
          },
          ratioNear('weather-main', 'calendar-main', 2 / 3),
          ratioNear('weather-main', 'tasks-main', 2 / 3),
        ],
      },
      {
        tree: [
          'V:2,1',
          'ID:map-main',
          'H:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
      },
    ),
    planned(
      'hold-inner-most-of-column',
      'Rebuild the board with one widget taking most of a column',
      'Show only the map, the journal and the calendar. Put the map on the left half, and on the right stack the journal above the calendar, with the journal taking up most of that column.',
      {
        visible: ['map-main', 'journal-main', 'calendar-main'],
        actions: [],
        tree: [
          'V:1,1',
          'ID:map-main',
          'H:3,1',
          'ID:journal-main',
          'ID:calendar-main',
        ],
        arrangement: [
          { kind: 'spansFullHeight', id: 'map-main' },
          { kind: 'leftOf', a: 'map-main', b: 'journal-main' },
          { kind: 'leftOf', a: 'map-main', b: 'calendar-main' },
          { kind: 'above', a: 'journal-main', b: 'calendar-main' },
          { kind: 'stacked', ids: ['journal-main', 'calendar-main'] },
          {
            kind: 'weightRatio',
            a: 'journal-main',
            b: 'calendar-main',
            min: 1.5,
            max: 9,
          },
        ],
      },
    ),
    planned(
      'hold-inner-control-board-size',
      'Size a widget against the whole board, leaving its neighbours even',
      'Make the map take two thirds of the screen width, keeping the calendar and the tasks stacked on the right.',
      {
        visible: ['map-main', 'calendar-main', 'tasks-main'],
        actions: [],
        tree: [
          'V:2,1',
          'ID:map-main',
          'H',
          'ID:calendar-main',
          'ID:tasks-main',
        ],
        arrangement: [
          { kind: 'spansFullHeight', id: 'map-main' },
          { kind: 'leftOf', a: 'map-main', b: 'calendar-main' },
          { kind: 'leftOf', a: 'map-main', b: 'tasks-main' },
          { kind: 'above', a: 'calendar-main', b: 'tasks-main' },
          { kind: 'stacked', ids: ['calendar-main', 'tasks-main'] },
          ratioNear('map-main', 'calendar-main', 4),
          ...equalAreas('calendar-main', ['tasks-main']),
        ],
      },
      { tree: ['V', 'ID:map-main', 'H', 'ID:calendar-main', 'ID:tasks-main'] },
    ),
    planned(
      'hold-inner-control-column-no-size',
      'Group two widgets in a column without stating a size',
      'Move the weather and the tasks into one column on the right, the weather above the tasks, with the calendar on the left.',
      {
        visible: BASE_VISIBLE,
        actions: [],
        tree: [
          'V',
          'ID:calendar-main',
          'H',
          'ID:weather-main',
          'ID:tasks-main',
        ],
        arrangement: [
          { kind: 'leftOf', a: 'calendar-main', b: 'weather-main' },
          { kind: 'leftOf', a: 'calendar-main', b: 'tasks-main' },
          { kind: 'above', a: 'weather-main', b: 'tasks-main' },
          { kind: 'stacked', ids: ['weather-main', 'tasks-main'] },
          ...equalAreas('weather-main', ['tasks-main']),
        ],
      },
    ),
  ].map(spatial),
  ...[
    planned(
      'hold-fresh-half-of-left-column',
      'The bottom widget takes half of its column',
      'Let the tasks at the bottom of the left column take up half of that column.',
      {
        visible: ['calendar-main', 'weather-main', 'tasks-main', 'map-main'],
        actions: [],
        tree: [
          'V:1,1',
          'H:1,1,2',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:map-main',
        ],
        arrangement: [
          {
            kind: 'order',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
            axis: 'y',
          },
          {
            kind: 'stacked',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
          },
          { kind: 'spansFullHeight', id: 'map-main' },
          { kind: 'leftOf', a: 'tasks-main', b: 'map-main' },
          ratioNear('tasks-main', 'calendar-main', 2),
          ratioNear('tasks-main', 'weather-main', 2),
        ],
      },
      {
        tree: [
          'V:1,1',
          'H:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:map-main',
        ],
        columns: 32,
        rows: 24,
      },
    ),
    planned(
      'hold-fresh-middle-twice-as-wide',
      'The middle of the top row twice as wide as its neighbours',
      'In the top row, make the calendar in the middle twice as wide as the widgets on either side of it.',
      {
        visible: ['weather-main', 'calendar-main', 'tasks-main', 'map-main'],
        actions: [],
        tree: [
          'H:1,1',
          'V:1,2,1',
          'ID:weather-main',
          'ID:calendar-main',
          'ID:tasks-main',
          'ID:map-main',
        ],
        arrangement: [
          {
            kind: 'order',
            ids: ['weather-main', 'calendar-main', 'tasks-main'],
            axis: 'x',
          },
          {
            kind: 'sideBySide',
            ids: ['weather-main', 'calendar-main', 'tasks-main'],
          },
          { kind: 'spansFullWidth', id: 'map-main' },
          { kind: 'above', a: 'calendar-main', b: 'map-main' },
          ratioNear('calendar-main', 'weather-main', 2),
          ratioNear('calendar-main', 'tasks-main', 2),
        ],
      },
      {
        tree: [
          'H:1,1',
          'V:1,1,1',
          'ID:weather-main',
          'ID:calendar-main',
          'ID:tasks-main',
          'ID:map-main',
        ],
        columns: 36,
        rows: 20,
      },
    ),
    planned(
      'hold-fresh-a-bit-smaller-than-neighbour',
      'One widget of a stacked pair a bit smaller than the other',
      'Make the journal a bit smaller than the weather sitting above it.',
      {
        visible: ['map-main', 'weather-main', 'journal-main'],
        actions: [],
        tree: [
          'V:2,1',
          'ID:map-main',
          'H:3,2',
          'ID:weather-main',
          'ID:journal-main',
        ],
        arrangement: [
          { kind: 'above', a: 'weather-main', b: 'journal-main' },
          { kind: 'spansFullHeight', id: 'map-main' },
          { kind: 'leftOf', a: 'map-main', b: 'weather-main' },
          { kind: 'leftOf', a: 'map-main', b: 'journal-main' },
          {
            kind: 'weightRatio',
            a: 'journal-main',
            b: 'weather-main',
            min: 0.4,
            max: 0.9,
          },
        ],
      },
      {
        tree: [
          'V:2,1',
          'ID:map-main',
          'H:1,1',
          'ID:weather-main',
          'ID:journal-main',
        ],
        columns: 30,
        rows: 20,
      },
    ),
    planned(
      'hold-fresh-quarter-after-move-to-top',
      'Move a widget to the top of its column and give it a quarter',
      "Move the journal to the top of the right-hand column and give it a quarter of that column's height; the other two can share what is left.",
      {
        visible: ['map-main', 'calendar-main', 'tasks-main', 'journal-main'],
        actions: [],
        tree: [
          'V:1,1',
          'ID:map-main',
          'H:2,3,3',
          'ID:journal-main',
          'ID:calendar-main',
          'ID:tasks-main',
        ],
        arrangement: [
          {
            kind: 'order',
            ids: ['journal-main', 'calendar-main', 'tasks-main'],
            axis: 'y',
          },
          {
            kind: 'stacked',
            ids: ['journal-main', 'calendar-main', 'tasks-main'],
          },
          { kind: 'spansFullHeight', id: 'map-main' },
          { kind: 'leftOf', a: 'map-main', b: 'journal-main' },
          ratioNear('journal-main', 'calendar-main', 2 / 3),
          ratioNear('journal-main', 'tasks-main', 2 / 3),
          ratioNear('calendar-main', 'tasks-main', 1),
        ],
      },
      {
        tree: [
          'V:1,1',
          'ID:map-main',
          'H:1,1,1',
          'ID:calendar-main',
          'ID:tasks-main',
          'ID:journal-main',
        ],
        columns: 28,
        rows: 24,
      },
    ),
    planned(
      'hold-fresh-keep-column-trade-others',
      'Trade two widgets and keep a stacked column untouched',
      "Trade the positions of the weather and the map, but don't touch the calendar and journal stacked on the left.",
      {
        visible: ['calendar-main', 'journal-main', 'weather-main', 'map-main'],
        actions: [],
        tree: [
          'V:1,1,1',
          'H:1,1',
          'ID:calendar-main',
          'ID:journal-main',
          'ID:map-main',
          'ID:weather-main',
        ],
        arrangement: [
          { kind: 'stacked', ids: ['calendar-main', 'journal-main'] },
          { kind: 'above', a: 'calendar-main', b: 'journal-main' },
          {
            kind: 'order',
            ids: ['calendar-main', 'map-main', 'weather-main'],
            axis: 'x',
          },
          {
            kind: 'order',
            ids: ['journal-main', 'map-main', 'weather-main'],
            axis: 'x',
          },
        ],
      },
      {
        tree: [
          'V:1,1,1',
          'H:1,1',
          'ID:calendar-main',
          'ID:journal-main',
          'ID:weather-main',
          'ID:map-main',
        ],
        columns: 40,
        rows: 20,
      },
    ),
    planned(
      'hold-fresh-keep-row-move-single',
      'Move one widget to a full-height side column and keep a row together',
      'Move the calendar into a full-height column on the left. The top row stays as it is.',
      {
        visible: [
          'weather-main',
          'tasks-main',
          'journal-main',
          'calendar-main',
        ],
        actions: [],
        tree: [
          'V:1,3',
          'ID:calendar-main',
          'V:1,1,1',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:journal-main',
        ],
        arrangement: [
          { kind: 'spansFullHeight', id: 'calendar-main' },
          { kind: 'leftOf', a: 'calendar-main', b: 'weather-main' },
          {
            kind: 'sideBySide',
            ids: ['weather-main', 'tasks-main', 'journal-main'],
          },
          {
            kind: 'order',
            ids: ['weather-main', 'tasks-main', 'journal-main'],
            axis: 'x',
          },
        ],
      },
      {
        tree: [
          'H:1,1',
          'V:1,1,1',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:journal-main',
          'ID:calendar-main',
        ],
        columns: 36,
        rows: 16,
      },
    ),
    planned(
      'hold-fresh-keep-column-show-hidden',
      'Show a hidden widget beside a column that stays untouched',
      'Bring the journal back and put it below the map. Leave the column on the right alone.',
      {
        visible: [
          'map-main',
          'journal-main',
          'calendar-main',
          'weather-main',
          'tasks-main',
        ],
        actions: [],
        tree: [
          'V:1,1',
          'H:1,1',
          'ID:map-main',
          'ID:journal-main',
          'H:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
        arrangement: [
          { kind: 'above', a: 'map-main', b: 'journal-main' },
          {
            kind: 'stacked',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
          },
          {
            kind: 'order',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
            axis: 'y',
          },
          { kind: 'leftOf', a: 'map-main', b: 'calendar-main' },
          { kind: 'leftOf', a: 'journal-main', b: 'tasks-main' },
        ],
      },
      {
        tree: [
          'V:1,1',
          'ID:map-main',
          'H:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
      },
    ),
    planned(
      'hold-fresh-all-in-one-row',
      'A grid lined up into one row',
      'Line every widget up in a single row, left to right.',
      {
        visible: ['calendar-main', 'map-main', 'tasks-main', 'weather-main'],
        actions: [],
        tree: [
          'V:1,1,1,1',
          'ID:calendar-main',
          'ID:map-main',
          'ID:tasks-main',
          'ID:weather-main',
        ],
        arrangement: [
          {
            kind: 'sideBySide',
            ids: ['calendar-main', 'map-main', 'tasks-main', 'weather-main'],
          },
          { kind: 'spansFullHeight', id: 'calendar-main' },
          { kind: 'spansFullHeight', id: 'map-main' },
          { kind: 'spansFullHeight', id: 'tasks-main' },
          { kind: 'spansFullHeight', id: 'weather-main' },
        ],
      },
      {
        tree: [
          'H:1,1',
          'V:1,1',
          'ID:calendar-main',
          'ID:map-main',
          'V:1,1',
          'ID:tasks-main',
          'ID:weather-main',
        ],
        columns: 40,
        rows: 18,
      },
    ),
    planned(
      'hold-fresh-all-in-one-column',
      'A row stacked into one column',
      'Stack all of them in one column, one on top of the other.',
      {
        visible: ['weather-main', 'journal-main', 'tasks-main'],
        actions: [],
        tree: [
          'H:1,1,1',
          'ID:weather-main',
          'ID:journal-main',
          'ID:tasks-main',
        ],
        arrangement: [
          {
            kind: 'stacked',
            ids: ['weather-main', 'journal-main', 'tasks-main'],
          },
          { kind: 'spansFullWidth', id: 'weather-main' },
          { kind: 'spansFullWidth', id: 'journal-main' },
          { kind: 'spansFullWidth', id: 'tasks-main' },
        ],
      },
      {
        tree: [
          'V:1,1,1',
          'ID:weather-main',
          'ID:journal-main',
          'ID:tasks-main',
        ],
        columns: 24,
        rows: 30,
      },
    ),
    planned(
      'hold-fresh-control-move-column-no-size',
      'Move a stacked column without stating an inner size',
      'Put the column with the calendar, weather and tasks on the right side of the map.',
      {
        visible: ['calendar-main', 'weather-main', 'tasks-main', 'map-main'],
        actions: [],
        tree: [
          'V:1,1',
          'ID:map-main',
          'H:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
        arrangement: [
          { kind: 'spansFullHeight', id: 'map-main' },
          { kind: 'leftOf', a: 'map-main', b: 'calendar-main' },
          { kind: 'leftOf', a: 'map-main', b: 'tasks-main' },
          {
            kind: 'order',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
            axis: 'y',
          },
          ...equalAreas('calendar-main', ['weather-main', 'tasks-main']),
        ],
      },
      {
        tree: [
          'V:1,1',
          'H:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:map-main',
        ],
        columns: 34,
        rows: 24,
      },
    ),
    planned(
      'hold-fresh-control-board-share-only',
      'A board-level share for one widget above a row',
      "Give the map about two thirds of the screen's height.",
      {
        visible: ['map-main', 'calendar-main', 'weather-main', 'tasks-main'],
        actions: [],
        tree: [
          'H:2,1',
          'ID:map-main',
          'V:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
        arrangement: [
          { kind: 'spansFullWidth', id: 'map-main' },
          { kind: 'dominant', id: 'map-main', minShare: 0.55 },
          { kind: 'above', a: 'map-main', b: 'weather-main' },
          {
            kind: 'order',
            ids: ['calendar-main', 'weather-main', 'tasks-main'],
            axis: 'x',
          },
          ...equalAreas('calendar-main', ['weather-main', 'tasks-main']),
        ],
      },
      {
        tree: [
          'H:1,1',
          'ID:map-main',
          'V:1,1,1',
          'ID:calendar-main',
          'ID:weather-main',
          'ID:tasks-main',
        ],
        columns: 36,
        rows: 24,
      },
    ),
  ].map(spatial),
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
      updateReasons: [
        ...(options.resizeFrom
          ? [{ type: 'chart_resize', previous: options.resizeFrom, current }]
          : []),
        ...(intent.length > 0 || !options.resizeFrom
          ? [{ type: 'user_intent', intent }]
          : []),
      ],
    },
    instances,
    vessels,
    layout: { type: 'tiling', tree: options.tree ?? BASE_TREE, instances },
  });
}

/**
 * A route request made after earlier turns in `history`, with the map in
 * `mapVariant`: the plan routes to `destination`.
 */
function routeAfter(
  id: string,
  title: string,
  intent: string,
  history: readonly LLMContextMessage[],
  destination: string,
  mapVariant = 'route',
): Scenario {
  return {
    ...planned(
      id,
      title,
      intent,
      {
        visible: [...BASE_VISIBLE, 'map-main'],
        actions: [
          {
            instanceId: 'map-main',
            action: 'showRoute',
            params: { destination },
          },
        ],
      },
      { variants: { map: mapVariant } },
    ),
    history,
  };
}

function spatial(scenario: Scenario): Scenario {
  return { ...scenario, spatial: true };
}

function control(scenario: Scenario): Scenario {
  return { ...scenario, spatial: false };
}

function unchanged(
  expected: Omit<Expectation, 'status' | 'arrangement'>,
): Omit<Expectation, 'status'> {
  return { ...expected, arrangement: [{ kind: 'unchangedTree' }] };
}

function equalAreas(
  reference: string,
  others: readonly string[],
): readonly ArrangementRule[] {
  return others.map((id) => ({
    kind: 'weightRatio',
    a: id,
    b: reference,
    min: 0.8,
    max: 1.25,
  }));
}

/** No instance in `others` gets more than twice the area of `reference`, nor less than half. */
function balanced(
  reference: string,
  others: readonly string[],
): readonly ArrangementRule[] {
  return others.map((id) => ({
    kind: 'weightRatio',
    a: id,
    b: reference,
    min: 0.5,
    max: 2,
  }));
}

/** The area of `a` over the area of `b` within a quarter of `target`: 0.8 to 1.25 times it. */
function ratioNear(a: string, b: string, target: number): ArrangementRule {
  return { kind: 'weightRatio', a, b, min: target * 0.8, max: target * 1.25 };
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
