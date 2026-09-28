import { workspaceVessels } from '../fixtures/workspace-vessels.js';
import type {
  addTask,
  BASE_VISIBLE,
  control,
  deferred,
  Expectation,
  InputOptions,
  planned,
  routeAfter,
  Scenario,
  STUDIO_ROUTE_TURN,
  spatial,
} from '../scenarios.js';

/** The scenario builders and demo constants {@link gateScenarios} composes from. */
export interface GateScenarioBuilders {
  readonly planned: typeof planned;
  readonly deferred: typeof deferred;
  readonly routeAfter: typeof routeAfter;
  readonly spatial: typeof spatial;
  readonly control: typeof control;
  readonly addTask: typeof addTask;
  readonly BASE_VISIBLE: typeof BASE_VISIBLE;
  readonly STUDIO_ROUTE_TURN: typeof STUDIO_ROUTE_TURN;
}

/**
 * Scenarios for the select stage's gates, on the demo board and on a
 * second, non-demo board of a music player, a stock watchlist and CRM
 * contacts, plus full-planner scenarios for prompts that dropped a
 * requested action or deferred too broadly. Each carries a complete
 * expectation and, where the gate it is about cannot be derived from the
 * expectation, its `expectedGates`. Development ids start `gate-`,
 * holdout ids `hold-gate-`.
 */
export function gateScenarios(
  build: GateScenarioBuilders,
): readonly Scenario[] {
  const {
    planned,
    deferred,
    routeAfter,
    spatial,
    control,
    addTask,
    BASE_VISIBLE,
    STUDIO_ROUTE_TURN,
  } = build;
  const withMap = [...BASE_VISIBLE, 'map-main'];
  const withJournal = [...BASE_VISIBLE, 'journal-main'];
  const route = (destination: string) => ({
    instanceId: 'map-main',
    action: 'showRoute',
    params: { destination },
  });
  const onScreen = { generatedContent: 'no', dependsOnScreen: 'yes' } as const;

  const showPhrasedViewChanges: Scenario[] = [
    planned(
      'gate-show-route-to-studio',
      'A view change phrased as show',
      'Show me the route to the studio.',
      { visible: withMap, actions: [route('Studio Vortex HQ')] },
    ),
    planned(
      'gate-show-hourly-forecast',
      'A view change phrased as show on a visible widget',
      'Show me the hourly forecast.',
      {
        visible: BASE_VISIBLE,
        actions: [{ instanceId: 'weather-main', action: 'showHourly' }],
      },
    ),
    planned(
      'gate-show-directions-to-gym',
      'Directions asked for as show',
      'Can you show directions to the gym?',
      { visible: withMap, actions: [route('Mission High Fitness')] },
    ),
    planned(
      'gate-show-price-chart',
      'A workspace view change phrased as show',
      'Show the price chart for AAPL.',
      {
        visible: WORKSPACE_VISIBLE,
        actions: [
          {
            instanceId: 'watchlist-main',
            action: 'showChart',
            params: { symbol: 'AAPL' },
          },
        ],
      },
      WORKSPACE,
    ),
    planned(
      'gate-show-contact-history',
      "A contact's history phrased as show",
      "Show me Dana Whitfield's history.",
      {
        visible: WORKSPACE_VISIBLE,
        actions: [{ instanceId: 'contacts-main', action: 'showHistory' }],
      },
      WORKSPACE,
    ),
    holdout(
      planned(
        'hold-gate-show-weekly-forecast',
        'The weekly forecast phrased as show',
        'Show the weekly forecast.',
        {
          visible: BASE_VISIBLE,
          actions: [{ instanceId: 'weather-main', action: 'showWeekly' }],
        },
      ),
    ),
    holdout(
      planned(
        'hold-gate-see-way-to-studio',
        'A route asked for as let me see',
        'Let me see how to get to the studio.',
        { visible: withMap, actions: [route('Studio Vortex HQ')] },
      ),
    ),
    holdout(
      planned(
        'hold-gate-pull-up-news',
        'Ticker news asked for as pull up',
        'Pull up the news for TSLA.',
        {
          visible: WORKSPACE_VISIBLE,
          actions: [
            {
              instanceId: 'watchlist-main',
              action: 'showNews',
              params: { symbol: 'TSLA' },
            },
          ],
        },
        WORKSPACE,
      ),
    ),
    holdout(
      planned(
        'hold-gate-show-lyrics',
        'Lyrics phrased as show',
        'Show the lyrics of this song.',
        {
          visible: WORKSPACE_VISIBLE,
          actions: [{ instanceId: 'player-main', action: 'showLyrics' }],
        },
        WORKSPACE,
      ),
    ),
  ];

  const noActions: Scenario[] = [
    planned('gate-show-map', 'Only showing a widget', 'Show me the map.', {
      visible: withMap,
      actions: [],
    }),
    planned('gate-hide-weather', 'Only hiding a widget', 'Hide the weather.', {
      visible: ['calendar-main', 'tasks-main'],
      actions: [],
    }),
    spatial(
      planned(
        'gate-watchlist-next-to-player',
        'Showing a widget at a stated place',
        'Show the watchlist next to the player.',
        { visible: WORKSPACE_VISIBLE, actions: [] },
        { ...WORKSPACE, tree: ['V', 'ID:player-main', 'ID:contacts-main'] },
      ),
    ),
    holdout(
      planned(
        'hold-gate-bring-tasks-back',
        'Only bringing a widget back',
        'Bring the tasks back.',
        { visible: BASE_VISIBLE, actions: [] },
        { tree: ['V', 'ID:calendar-main', 'ID:weather-main'] },
      ),
    ),
    holdout(
      planned(
        'hold-gate-close-contacts',
        'Only closing a workspace widget',
        'Close the contacts.',
        { visible: ['player-main', 'watchlist-main'], actions: [] },
        WORKSPACE,
      ),
    ),
  ];

  const generatedContent: Scenario[] = [
    withGates(
      deferred(
        'gate-capital-of-australia',
        'A question answered in the reply',
        "What's the capital of Australia?",
        'select',
      ),
      { generatedContent: 'yes' },
    ),
    withGates(
      deferred(
        'gate-read-headlines',
        'Live outside data no parameter holds',
        "Read me today's top headlines.",
        'select',
      ),
      { generatedContent: 'yes' },
    ),
    holdout(
      withGates(
        deferred(
          'hold-gate-banana-calories',
          'A fact answered in the reply',
          'How many calories are in a banana?',
          'select',
        ),
        { generatedContent: 'yes' },
      ),
    ),
    holdout(
      withGates(
        deferred(
          'hold-gate-tell-joke',
          'Invented content answered in the reply',
          'Tell me a joke.',
          'select',
        ),
        { generatedContent: 'yes' },
      ),
    ),
  ];

  const parameterBoundContent: Scenario[] = [
    planned(
      'gate-add-task-buy-milk',
      'Content that fits an action parameter',
      'Add a task to buy milk.',
      {
        visible: BASE_VISIBLE,
        actions: [{ instanceId: 'tasks-main', action: 'addTask' }],
      },
    ),
    planned(
      'gate-add-task-eiffel-city',
      'A parameter filled from world knowledge',
      'Add a task to go to the city where the Eiffel Tower is.',
      {
        visible: BASE_VISIBLE,
        actions: [{ instanceId: 'tasks-main', action: 'addTask' }],
      },
    ),
    planned(
      'gate-note-to-dana',
      'A note whose text the request states',
      'Add a note to Dana saying she prefers email.',
      {
        visible: WORKSPACE_VISIBLE,
        actions: [{ instanceId: 'contacts-main', action: 'addNote' }],
      },
      WORKSPACE,
    ),
    planned(
      'gate-journal-groceries',
      'A journal entry whose title and text the request states',
      'Start a journal entry titled Groceries and write eggs and bread.',
      {
        visible: withJournal,
        actions: [
          {
            instanceId: 'journal-main',
            action: 'createEntry',
            params: { title: 'Groceries' },
          },
          { instanceId: 'journal-main', action: 'writeContent' },
        ],
      },
    ),
    holdout(
      planned(
        'hold-gate-queue-bohemian-band',
        'A track filled from world knowledge',
        'Queue a song by the band that sang Bohemian Rhapsody.',
        {
          visible: WORKSPACE_VISIBLE,
          actions: [{ instanceId: 'player-main', action: 'addToQueue' }],
        },
        WORKSPACE,
      ),
    ),
    holdout(
      planned(
        'hold-gate-add-apple-ticker',
        'A ticker filled from world knowledge',
        "Add Apple's ticker to my watchlist.",
        {
          visible: WORKSPACE_VISIBLE,
          actions: [
            {
              instanceId: 'watchlist-main',
              action: 'addSymbol',
              params: { symbol: 'AAPL' },
            },
          ],
        },
        WORKSPACE,
      ),
    ),
  ];

  const screenDependent: Scenario[] = [
    withGates(
      deferred(
        'gate-task-per-calendar-event',
        'Values only readable off the calendar',
        'Add a task for each event on my calendar.',
        'select',
      ),
      onScreen,
    ),
    withGates(
      deferred(
        'gate-note-summarising-chart',
        'A note summarising what a widget shows',
        "Add a note to Dana summarising the chart I'm looking at.",
        'select',
        WORKSPACE,
      ),
      onScreen,
    ),
    holdout(
      withGates(
        deferred(
          'hold-gate-copy-tasks-to-journal',
          'Copying one widget into another',
          'Copy my task list into the journal.',
          'select',
        ),
        onScreen,
      ),
    ),
    holdout(
      withGates(
        deferred(
          'hold-gate-log-call-open-contact',
          'A contact named only by what is open',
          "Log a call with the contact that's open.",
          'select',
          WORKSPACE,
        ),
        onScreen,
      ),
    ),
  ];

  const screenIndependent: Scenario[] = [
    withGates(
      planned(
        'gate-write-call-mom',
        'Journal text the request states',
        'Write call mom in the journal.',
        {
          visible: withJournal,
          actions: [{ instanceId: 'journal-main', action: 'writeContent' }],
        },
        { variants: { journal: 'entry' } },
      ),
      { dependsOnScreen: 'no' },
    ),
    withGates(
      planned(
        'gate-log-call-with-dana',
        'A call summary the request states',
        'Log a call with Dana: discussed the renewal.',
        {
          visible: WORKSPACE_VISIBLE,
          actions: [{ instanceId: 'contacts-main', action: 'logCall' }],
        },
        WORKSPACE,
      ),
      { dependsOnScreen: 'no' },
    ),
    holdout(
      withGates(
        planned(
          'hold-gate-add-send-invoice',
          'A task title the request states',
          'Add a task called Send invoice.',
          { visible: BASE_VISIBLE, actions: [addTask('Send invoice')] },
        ),
        { dependsOnScreen: 'no' },
      ),
    ),
  ];

  const spatialControls: Scenario[] = [
    spatial(
      planned(
        'gate-player-left-of-watchlist',
        'A stated order on the workspace board',
        'Put the player to the left of the watchlist.',
        {
          visible: WORKSPACE_VISIBLE,
          actions: [],
          tree: [
            'V:1,1,1',
            'ID:player-main',
            'ID:watchlist-main',
            'ID:contacts-main',
          ],
          arrangement: [
            { kind: 'leftOf', a: 'player-main', b: 'watchlist-main' },
          ],
        },
        {
          ...WORKSPACE,
          tree: [
            'V:1,1,1',
            'ID:watchlist-main',
            'ID:player-main',
            'ID:contacts-main',
          ],
        },
      ),
    ),
    control(
      planned(
        'gate-show-contacts',
        'Showing a workspace widget without a place',
        'Show the contacts.',
        { visible: WORKSPACE_VISIBLE, actions: [] },
        { ...WORKSPACE, tree: ['V', 'ID:player-main', 'ID:watchlist-main'] },
      ),
    ),
  ];

  const literalPrompts: Scenario[] = [
    planned(
      'map-and-route-to-studio',
      'Show a widget and run its route in one request',
      'Show me the map and the route to the studio.',
      { visible: withMap, actions: [route('Studio Vortex HQ')] },
    ),
    routeAfter(
      'route-there-again-short',
      'Repeat the last route from a short back reference',
      'Route there again.',
      STUDIO_ROUTE_TURN,
      'Studio Vortex HQ',
    ),
    withGates(
      deferred(
        'journal-key-points-of-todays-plan',
        "Journal content read off today's schedule",
        "Start a journal entry about today's plan and jot down the key points.",
        'select',
      ),
      onScreen,
    ),
  ];

  return [
    ...showPhrasedViewChanges,
    ...noActions,
    ...generatedContent,
    ...parameterBoundContent,
    ...screenDependent,
    ...screenIndependent,
    ...spatialControls,
    ...literalPrompts,
  ];
}

const WORKSPACE_VISIBLE = ['player-main', 'watchlist-main', 'contacts-main'];

const WORKSPACE: InputOptions = {
  instances: ['player', 'watchlist', 'contacts'],
  vessels: workspaceVessels,
  tree: ['V:1,1,1', 'ID:player-main', 'ID:watchlist-main', 'ID:contacts-main'],
};

function holdout(scenario: Scenario): Scenario {
  return { ...scenario, suite: 'holdout' };
}

function withGates(
  scenario: Scenario,
  expectedGates: NonNullable<Expectation['expectedGates']>,
): Scenario {
  return { ...scenario, expected: { ...scenario.expected, expectedGates } };
}
