/**
 * MAE-655 reproduction harness.
 *
 * The defect is a model judgment, not a code path: on a `chart_resize`-only
 * turn the Engine sometimes re-emits an Action it already ran, duplicating its
 * effect. It cannot be reproduced on demand, only measured as a rate.
 *
 * Each trial seeds a history store with one synthetic prior turn (a user
 * intent that added a task), optionally followed by a run of bare
 * `chart_resize`-only turns (no paired user message, to match how the real
 * history records a resize-triggered turn), then sends a final resize-only
 * request and records what the model proposed.
 *
 * `executionPlan.length` alone is not a defect signal once the Engine grows a
 * guard that drops a re-emitted action into `diagnostics.skippedActions`: a
 * guard-suppressed hit would read as 0 for the wrong reason. The Engine
 * strips `diagnostics` before it crosses the public `handle()` boundary
 * (packages/engine/src/lib/engine.ts:334, `const { diagnostics, ...response }
 * = retried.value`), so this harness injects a custom `Logger` and reads the
 * scalar `skippedActions` count off the "Response healed" log line
 * (packages/engine/src/lib/engine.ts:340-356) instead. Per trial this harness
 * records:
 *   - `plan`    — executionPlan.length (actions that survived to the client)
 *   - `skipped` — skippedActions count from the "Response healed" log (0 if
 *                 the line never fires, e.g. no guard yet)
 *   - `emitted` — plan + skipped, i.e. what the model actually proposed
 * The headline rate is `emitted > 0` over N. `plan > 0` and `skipped > 0` are
 * reported separately: together they distinguish "model emitted nothing"
 * (prompt fix worked) from "model emitted, guard dropped it" (guard worked).
 *
 * One LLM call per trial.
 *
 * Run (legacy positional form, preserved exactly):
 *   OPENAI_API_KEY=sk-... bun --conditions=@maelstrom-co/source \
 *     run scripts/eval-mae655-resize-replay.ts [trials] [priorMessage] [priorIntent]
 *
 * Run (named flags — required to reach the new sweep knobs; any `--flag`
 * argument switches parsing into this mode and positional args are ignored):
 *   OPENAI_API_KEY=sk-... bun --conditions=@maelstrom-co/source \
 *     run scripts/eval-mae655-resize-replay.ts \
 *     --trials=30 --prior-message='Added "Buy milk" to your task list.' \
 *     --prior-intent='add a task to buy milk' --resize-to=7x11 --intervening=0
 *
 * Run against Gemini instead of OpenAI (`--provider` defaults to `openai`,
 * and each provider carries its own default model that `ENGINE_MODEL`
 * overrides):
 *   GOOGLE_API_KEY=... bun --conditions=@maelstrom-co/source \
 *     run scripts/eval-mae655-resize-replay.ts --provider=gemini --trials=30
 *
 * `--conditions=@maelstrom-co/source` is required: without it
 * `@maelstrom-co/engine` resolves to a `dist/` that does not exist in an
 * unbuilt worktree.
 *
 * SIGINT/SIGTERM print the partial summary over whatever trials completed
 * and exit; a full run's summary line is repeated at the end unchanged.
 *
 * Exits non-zero when any trial reproduces the defect (`emitted > 0`).
 */
import {
  createEngine,
  createInMemoryStore,
  type Logger,
} from '@maelstrom-co/engine';
import { defineVessel } from '@maelstrom-co/protocol';
import type { AnyTextAdapter } from '@tanstack/ai';
import { createGeminiChat, type GeminiTextModel } from '@tanstack/ai-gemini';
import { createOpenaiChat, type OpenAIChatModel } from '@tanstack/ai-openai';

const DEFAULT_MODELS: { openai: OpenAIChatModel; gemini: GeminiTextModel } = {
  openai: 'gpt-5.6-luna',
  gemini: 'gemini-3.1-flash-lite-preview',
};

const config = parseArgs(process.argv.slice(2));

const apiKey = requireApiKey(config.provider);

const model: string =
  process.env.ENGINE_MODEL?.trim() ?? DEFAULT_MODELS[config.provider];

/**
 * Mirrors `apps/demo/src/vessels/tasks.vessel.ts`,
 * `apps/demo/src/vessels/calendar.vessel.ts`,
 * `apps/demo/src/vessels/weather.vessel.ts`,
 * `apps/demo/src/vessels/journal.vessel.ts`, and
 * `apps/demo/src/vessels/map.vessel.ts`. Redeclared rather than imported
 * because those modules pull in `@maelstrom-co/react` and `.tsx` skeletons,
 * neither of which belongs in a headless script. Only the fields the Engine
 * is shown matter here: id, description, variants, and the action
 * signatures. Keep in sync if any real Vessel's actions change.
 */
const tasksVessel = defineVessel({
  id: 'tasks',
  name: 'Tasks',
  description:
    'Task list with checkboxes, subtasks, and progress tracking. Supports adding, removing, checking, and nesting tasks.',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [
        {
          name: 'addTask',
          description: 'Add a new task to the list',
          parameters: [
            { name: 'title', type: 'string', description: 'Task title' },
          ],
        },
        {
          name: 'removeTask',
          description: 'Remove a task by title',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: 'Title of the task to remove',
            },
          ],
        },
        {
          name: 'checkTask',
          description: 'Mark a task as complete',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: 'Title of the task to check',
            },
          ],
        },
        {
          name: 'uncheckTask',
          description: 'Mark a task as incomplete',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: 'Title of the task to uncheck',
            },
          ],
        },
        {
          name: 'addSubtask',
          description: 'Add a subtask under an existing task',
          parameters: [
            {
              name: 'taskTitle',
              type: 'string',
              description: 'Title of the parent task',
            },
            {
              name: 'subtaskTitle',
              type: 'string',
              description: 'Title of the subtask to add',
            },
          ],
        },
      ],
    },
  },
});

const CALENDAR_EVENT_ACTIONS = [
  {
    name: 'addEvent',
    description: "Add an event to today's schedule",
    parameters: [
      { name: 'title', type: 'string', description: 'Event title' },
      {
        name: 'time',
        type: 'string',
        description: 'Time like 9:00 or 14:30',
      },
    ],
  },
  {
    name: 'removeEvent',
    description: "Remove an event from today's schedule by title",
    parameters: [
      {
        name: 'title',
        type: 'string',
        description: 'Title of the event to remove',
      },
    ],
  },
  {
    name: 'moveEvent',
    description: "Reschedule an event on today's schedule to a new time",
    parameters: [
      {
        name: 'title',
        type: 'string',
        description: 'Title of the event to move',
      },
      {
        name: 'time',
        type: 'string',
        description: 'New time like 9:00 or 14:30',
      },
    ],
  },
] as const;

const calendarVessel = defineVessel({
  id: 'calendar',
  name: 'Calendar',
  description:
    'Calendar widget for viewing dates and scheduling. Supports month view, week view, and day view with hourly time blocks. Every view also supports addEvent, removeEvent, and moveEvent for today\'s schedule — use these whenever the user adds, cancels, or reschedules something for today. Today\'s day view starts with a 7:30 AM "Gym" and a 10:00 AM "Design review — Studio Vortex HQ". When the user asks about getting somewhere or being there by a time, pair with the map vessel\'s showRoute action, passing the event\'s location (e.g. "Studio Vortex HQ") as the destination.',
  defaultVariant: 'month',
  variants: {
    month: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'showWeek',
          description: 'Switch to week view for event timeline',
          transitionsTo: 'week',
        },
        {
          name: 'showDay',
          description: 'Switch to day view for hourly schedule',
          transitionsTo: 'day',
        },
        ...CALENDAR_EVENT_ACTIONS.map((action) => ({
          ...action,
          transitionsTo: 'day' as const,
        })),
      ],
    },
    week: {
      props: {},
      minSize: { width: 6, height: 3 },
      actions: [
        {
          name: 'showMonth',
          description: 'Switch back to month view',
          transitionsTo: 'month',
        },
        {
          name: 'showDay',
          description: 'Switch to day view',
          transitionsTo: 'day',
        },
        ...CALENDAR_EVENT_ACTIONS,
      ],
    },
    day: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'showMonth',
          description: 'Switch to month view',
          transitionsTo: 'month',
        },
        {
          name: 'showWeek',
          description: 'Switch to week view',
          transitionsTo: 'week',
        },
        ...CALENDAR_EVENT_ACTIONS,
      ],
    },
  },
});

const WEATHER_SET_LOCATION_ACTION = {
  name: 'setLocation',
  description:
    'Try to load weather for a city or place without assuming the request succeeds',
  parameters: [
    {
      name: 'location',
      type: 'string',
      description: 'City or place to request weather for',
    },
  ],
} as const;

const weatherVessel = defineVessel({
  id: 'weather',
  name: 'Weather',
  description:
    'Weather widget showing current conditions or extended forecast. Can display current weather, hourly forecast, or weekly forecast.',
  defaultVariant: 'current',
  variants: {
    current: {
      props: {},
      minSize: { width: 6, height: 4 },
      actions: [
        WEATHER_SET_LOCATION_ACTION,
        {
          name: 'showHourly',
          description: 'Show hourly forecast for today',
          transitionsTo: 'hourly',
        },
        {
          name: 'showWeekly',
          description: 'Show weekly forecast',
          transitionsTo: 'weekly',
        },
      ],
    },
    hourly: {
      props: {},
      minSize: { width: 9, height: 4 },
      actions: [
        WEATHER_SET_LOCATION_ACTION,
        {
          name: 'showCurrent',
          description: 'Show current conditions',
          transitionsTo: 'current',
        },
        {
          name: 'showWeekly',
          description: 'Show weekly forecast',
          transitionsTo: 'weekly',
        },
      ],
    },
    weekly: {
      props: {},
      minSize: { width: 8, height: 3 },
      actions: [
        WEATHER_SET_LOCATION_ACTION,
        {
          name: 'showCurrent',
          description: 'Show current conditions',
          transitionsTo: 'current',
        },
        {
          name: 'showHourly',
          description: 'Show hourly forecast',
          transitionsTo: 'hourly',
        },
      ],
    },
  },
});

const journalVessel = defineVessel({
  id: 'journal',
  name: 'Journal',
  description:
    'Personal journal for writing entries. List view shows recent entries, entry view enables scribe mode where the AI can dictate content.',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [
        {
          name: 'createEntry',
          description: 'Create a new journal entry and open it for writing',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: 'Title of the entry',
            },
          ],
          transitionsTo: 'entry',
        },
        {
          name: 'openEntry',
          description:
            'Open an existing journal entry by title so it becomes visible in all entry-variant tiles. Matches case-insensitively; falls back to substring match if no exact title matches.',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description:
                'Title of the entry to open. Matched case-insensitively, with substring fallback.',
            },
          ],
          transitionsTo: 'entry',
        },
      ],
    },
    entry: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'createEntry',
          description: 'Create a new journal entry and open it for writing',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: 'Title of the entry',
            },
          ],
        },
        {
          name: 'openEntry',
          description:
            'Open an existing journal entry by title so it becomes visible in all entry-variant tiles. Matches case-insensitively; falls back to substring match if no exact title matches.',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description:
                'Title of the entry to open. Matched case-insensitively, with substring fallback.',
            },
          ],
        },
        {
          name: 'writeContent',
          description:
            'Append text to the current journal entry. Works like a scribe taking dictation.',
          parameters: [
            {
              name: 'text',
              type: 'string',
              description: 'Text to append to the entry',
            },
          ],
        },
        {
          name: 'backToList',
          description: 'Return to the journal entries list',
          transitionsTo: 'list',
        },
      ],
    },
  },
});

/**
 * Mirrors `DEMO_LOCATIONS` (apps/demo/src/lib/locations.ts), inlined as
 * plain names because the harness only needs the `enum` values
 * `withActionOptions` (apps/demo/src/lib/vessel-options.ts) attaches to
 * `showRoute.destination` and `focusLocation.name` in production.
 */
const MAP_LOCATION_NAMES: string[] = [
  'Home',
  'Studio Vortex HQ',
  'Mission High Fitness',
  'Ritual Coffee',
];

const mapVessel = defineVessel({
  id: 'map',
  name: 'Map',
  description:
    'City map showing saved places and routes. Use this whenever the user asks about getting somewhere, travel time, or directions — including "I need to be at X by Y", "how do I get to X", "when should I leave", or any time an appointment\'s location matters for planning the trip there. Overview shows all locations; route shows directions and travel time to a destination; compact shows a single place card.',
  defaultVariant: 'overview',
  variants: {
    overview: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'showRoute',
          description:
            'Show driving directions and travel time to a destination',
          parameters: [
            {
              name: 'destination',
              type: 'string',
              description: 'Name of the destination location',
              enum: MAP_LOCATION_NAMES,
            },
          ],
          transitionsTo: 'route',
        },
        {
          name: 'focusLocation',
          description: 'Show a single saved place as a compact card',
          parameters: [
            {
              name: 'name',
              type: 'string',
              description: 'Name of the location to focus on',
              enum: MAP_LOCATION_NAMES,
            },
          ],
          transitionsTo: 'compact',
        },
      ],
    },
    route: {
      props: {},
      minSize: { width: 6, height: 4 },
      actions: [
        {
          name: 'showOverview',
          description: 'Show all saved locations',
          transitionsTo: 'overview',
        },
        {
          name: 'showRoute',
          description:
            'Show driving directions and travel time to a destination',
          parameters: [
            {
              name: 'destination',
              type: 'string',
              description: 'Name of the destination location',
              enum: MAP_LOCATION_NAMES,
            },
          ],
        },
        {
          name: 'focusLocation',
          description: 'Show a single saved place as a compact card',
          parameters: [
            {
              name: 'name',
              type: 'string',
              description: 'Name of the location to focus on',
              enum: MAP_LOCATION_NAMES,
            },
          ],
          transitionsTo: 'compact',
        },
      ],
    },
    compact: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [
        {
          name: 'showOverview',
          description: 'Show all saved locations',
          transitionsTo: 'overview',
        },
        {
          name: 'showRoute',
          description:
            'Show driving directions and travel time to a destination',
          parameters: [
            {
              name: 'destination',
              type: 'string',
              description: 'Name of the destination location',
              enum: MAP_LOCATION_NAMES,
            },
          ],
          transitionsTo: 'route',
        },
      ],
    },
  },
});

/**
 * Mirrors `createPlaygroundEngine` (apps/demo/src/server/engine-config.ts).
 * Inlined rather than reused because that factory owns its history store, and
 * this harness must seed one. Keep in sync: an eval running a different config
 * measures a different system.
 */
const SYSTEM_RULES = `
- Try to always keep at least one vessel visible on the chart
- Give each vessel adequate space for its content`;

const instances = [
  { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
];
const vessels = [
  tasksVessel,
  calendarVessel,
  weatherVessel,
  journalVessel,
  mapVessel,
];
const layout = { type: 'tiling' as const, tree: ['ID:tasks-main'], instances };

const PRIOR_CHART_DIMENSIONS = { columns: 12, rows: 8 };

function priorTurn(sessionId: string) {
  return {
    kind: 'turn' as const,
    input: {
      type: 'chart_request' as const,
      sessionId,
      id: 'req-prior',
      timestamp: Date.now() - 60_000,
      request: {
        type: 'chart_request' as const,
        context: {
          updateReasons: [{ type: 'user_intent', intent: config.priorIntent }],
          chartDimensions: PRIOR_CHART_DIMENSIONS,
          layoutMode: 'tiling' as const,
        },
        instances,
        vessels,
        layout,
      },
    },
    output: {
      type: 'chart_response' as const,
      sessionId,
      id: 'req-prior',
      response: {
        type: 'maelstrom_response' as const,
        requestId: 'req-prior',
        userMessage: config.priorMessage,
        rationale: 'User asked to add a task.',
        executionPlan: [
          {
            instanceId: 'tasks-main',
            action: 'addTask',
            params: { title: 'Buy milk' },
          },
        ],
        layout,
      },
    },
  };
}

/**
 * A bare `chart_resize`-only turn: no paired user message, mirroring how
 * `extractUserIntent` (packages/engine/src/lib/history/history-manager.ts:297)
 * yields nothing for a resize-only `updateReasons`
 * (packages/engine/src/lib/history/history-manager.ts:355-359). Used to seed
 * a run of unpaired assistant turns ahead of the final resize request.
 */
function interveningResizeTurn(
  sessionId: string,
  index: number,
  previous: ChartDims,
  current: ChartDims,
) {
  const id = `req-resize-${index}`;
  return {
    kind: 'turn' as const,
    input: {
      type: 'chart_request' as const,
      sessionId,
      id,
      timestamp: Date.now() - 30_000 + index,
      request: {
        type: 'chart_request' as const,
        context: {
          updateReasons: [{ type: 'chart_resize' as const, previous, current }],
          chartDimensions: current,
          layoutMode: 'tiling' as const,
        },
        instances,
        vessels,
        layout,
      },
    },
    output: {
      type: 'chart_response' as const,
      sessionId,
      id,
      response: {
        type: 'maelstrom_response' as const,
        requestId: id,
        userMessage: 'Adjusted the layout for the new chart size.',
        rationale: 'Chart was resized; no content change needed.',
        executionPlan: [],
        layout,
      },
    },
  };
}

function resizeRequest(
  sessionId: string,
  previous: ChartDims,
  current: ChartDims,
) {
  return {
    type: 'chart_request' as const,
    sessionId,
    id: 'req-resize',
    timestamp: Date.now(),
    request: {
      type: 'chart_request' as const,
      context: {
        updateReasons: [{ type: 'chart_resize' as const, previous, current }],
        chartDimensions: current,
        layoutMode: 'tiling' as const,
      },
      instances,
      vessels,
      layout,
    },
  };
}

function createDiagnosticsLogger(): {
  logger: Logger;
  skippedActions: () => number;
} {
  let skipped = 0;
  const capture = (message: string, data?: Record<string, unknown>) => {
    if (message !== 'Response healed') return;
    const count = data?.skippedActions;
    if (typeof count === 'number') skipped = count;
  };
  return {
    logger: {
      debug: () => {},
      info: capture,
      warn: capture,
      error: (message, _error, data) => capture(message, data),
    },
    skippedActions: () => skipped,
  };
}

let hits = 0;
let planHits = 0;
let skippedHits = 0;
let errors = 0;
let completed = 0;

function printSummary(final: boolean): void {
  const label = final ? 'FINAL' : 'PARTIAL';
  const rate = ((hits / Math.max(completed, 1)) * 100).toFixed(1);
  console.log(
    `\n[${label}] provider=${config.provider} model=${model} ` +
      `N=${config.trials} hits=${hits} rate=${rate}% ` +
      `completed=${completed} plan>0=${planHits} skipped>0=${skippedHits} errors=${errors}`,
  );
}

function printConfig(): void {
  console.log(
    [
      `provider=${config.provider}`,
      `model=${model}`,
      `trials=${config.trials}`,
      `priorMessage=${JSON.stringify(config.priorMessage)}`,
      `priorIntent=${JSON.stringify(config.priorIntent)}`,
      `resize=${PRIOR_CHART_DIMENSIONS.columns}x${PRIOR_CHART_DIMENSIONS.rows}->${config.resizeTo.columns}x${config.resizeTo.rows}`,
      `intervening=${config.intervening}`,
      `vessels=${vessels.length}`,
    ].join(' '),
  );
}

let interrupted = false;
function onInterrupt(signal: string): void {
  if (interrupted) return;
  interrupted = true;
  console.log(`\nreceived ${signal}, printing partial results`);
  printSummary(false);
  process.exit(hits > 0 ? 1 : 0);
}
process.on('SIGINT', () => onInterrupt('SIGINT'));
process.on('SIGTERM', () => onInterrupt('SIGTERM'));

printConfig();

for (let trial = 0; trial < config.trials; trial += 1) {
  const sessionId = `eval-${Date.now()}-${trial}`;
  const store = createInMemoryStore();
  const { logger, skippedActions } = createDiagnosticsLogger();

  // Branded ids and schema-validated payloads are enforced at the wire
  // boundary; this harness constructs both by hand on purpose.
  await store.append(sessionId as never, priorTurn(sessionId) as never);

  const waypoints = interveningWaypoints(
    config.intervening,
    PRIOR_CHART_DIMENSIONS,
    config.resizeTo,
  );
  let lastDims: ChartDims = PRIOR_CHART_DIMENSIONS;
  for (let i = 0; i < config.intervening; i += 1) {
    const current = waypoints[i] as ChartDims;
    await store.append(
      sessionId as never,
      interveningResizeTurn(sessionId, i, lastDims, current) as never,
    );
    lastDims = current;
  }

  const engine = createEngine({
    adapter: createAdapter(),
    maxRetries: 2,
    history: { store, maxEntries: 20 },
    prompt: { system: { rules: { append: SYSTEM_RULES } } },
    logger,
  });

  const result = await engine.handle(
    resizeRequest(sessionId, lastDims, config.resizeTo) as never,
  );

  completed += 1;

  if (!result.ok) {
    errors += 1;
    console.log(
      `${trial} ERR ${result.error._tag} | tally hits=${hits}/${completed}`,
    );
    continue;
  }

  const plan =
    result.value.type === 'chart_response'
      ? result.value.response.executionPlan
      : [];
  const skipped = skippedActions();
  const emitted = plan.length + skipped;

  if (plan.length > 0) planHits += 1;
  if (skipped > 0) skippedHits += 1;
  if (emitted > 0) {
    hits += 1;
    const rendered = plan
      .map(
        (action) =>
          `${action.instanceId}.${action.action}(${JSON.stringify(action.params ?? {})})`,
      )
      .join(', ');
    console.log(
      `${trial} HIT plan=${plan.length} skipped=${skipped} emitted=${emitted}` +
        `${rendered.length > 0 ? ` [${rendered}]` : ''} | tally hits=${hits}/${completed}`,
    );
  } else {
    console.log(
      `${trial} ok plan=0 skipped=0 emitted=0 | tally hits=${hits}/${completed}`,
    );
  }
}

printSummary(true);

process.exit(hits > 0 ? 1 : 0);

interface ChartDims {
  readonly columns: number;
  readonly rows: number;
}

type Provider = 'openai' | 'gemini';

interface HarnessConfig {
  readonly provider: Provider;
  readonly trials: number;
  readonly priorMessage: string;
  readonly priorIntent: string;
  readonly resizeTo: ChartDims;
  readonly intervening: number;
}

/**
 * Chains `count` distinct resize waypoints from `start`, none equal to
 * `final`, so the measured turn's `previous` (the last waypoint, or `start`
 * when `count` is 0) never equals its `current` (`final`).
 */
function interveningWaypoints(
  count: number,
  start: ChartDims,
  final: ChartDims,
): ChartDims[] {
  const waypoints: ChartDims[] = [];
  for (let i = 0; i < count; i += 1) {
    let candidate: ChartDims = {
      columns: start.columns + i + 1,
      rows: start.rows + i + 1,
    };
    while (dimsEqual(candidate, final)) {
      candidate = { columns: candidate.columns + 1, rows: candidate.rows + 1 };
    }
    waypoints.push(candidate);
  }
  return waypoints;
}

function dimsEqual(a: ChartDims, b: ChartDims): boolean {
  return a.columns === b.columns && a.rows === b.rows;
}

function parseProvider(value: string): Provider {
  if (value === 'openai' || value === 'gemini') return value;
  console.error(
    `invalid --provider value ${JSON.stringify(value)}, expected openai or gemini`,
  );
  process.exit(1);
}

function requireApiKey(provider: Provider): string {
  if (provider === 'gemini') {
    const key =
      process.env.GOOGLE_API_KEY?.trim() ?? process.env.GEMINI_API_KEY?.trim();
    if (key) return key;
    console.error(
      'GOOGLE_API_KEY (or GEMINI_API_KEY) required for --provider=gemini',
    );
    process.exit(1);
  }
  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) return key;
  console.error('OPENAI_API_KEY required');
  process.exit(1);
}

function createAdapter(): AnyTextAdapter {
  return config.provider === 'gemini'
    ? createGeminiChat(model as GeminiTextModel, apiKey)
    : createOpenaiChat(model as OpenAIChatModel, apiKey);
}

function parseDims(spec: string, flagName: string): ChartDims {
  const match = /^(\d+)x(\d+)$/.exec(spec.trim());
  if (!match) {
    console.error(
      `invalid ${flagName} value ${JSON.stringify(spec)}, expected COLUMNSxROWS e.g. 7x11`,
    );
    process.exit(1);
  }
  return { columns: Number(match[1]), rows: Number(match[2]) };
}

/**
 * Named flags (`--trials=`, `--prior-message=`, `--prior-intent=`,
 * `--resize-to=`, `--intervening=`) are the only way to reach the new sweep
 * knobs. Any `--flag` argument switches parsing into named mode and the
 * legacy positional args (`trials`, `priorMessage`, `priorIntent`) are
 * ignored in that mode. With zero `--flag` arguments, parsing falls back to
 * the original positional form for backwards compatibility.
 */
function parseArgs(argv: readonly string[]): HarnessConfig {
  const defaults: HarnessConfig = {
    provider: 'openai',
    trials: 30,
    priorMessage: 'Added "Buy milk" to your task list.',
    priorIntent: 'add a task to buy milk',
    resizeTo: { columns: 7, rows: 11 },
    intervening: 0,
  };

  const hasFlags = argv.some((arg) => arg.startsWith('--'));
  if (!hasFlags) {
    return {
      ...defaults,
      trials: Number(argv[0] ?? defaults.trials),
      priorMessage: argv[1] ?? defaults.priorMessage,
      priorIntent: argv[2] ?? defaults.priorIntent,
    };
  }

  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) {
      console.error(`flag ${arg} needs a value, e.g. ${arg}=value`);
      process.exit(1);
    }
    flags.set(arg.slice(2, eq), arg.slice(eq + 1));
  }

  return {
    provider: flags.has('provider')
      ? parseProvider(flags.get('provider') as string)
      : defaults.provider,
    trials: Number(flags.get('trials') ?? defaults.trials),
    priorMessage: flags.get('prior-message') ?? defaults.priorMessage,
    priorIntent: flags.get('prior-intent') ?? defaults.priorIntent,
    resizeTo: flags.has('resize-to')
      ? parseDims(flags.get('resize-to') as string, '--resize-to')
      : defaults.resizeTo,
    intervening: Number(flags.get('intervening') ?? defaults.intervening),
  };
}
