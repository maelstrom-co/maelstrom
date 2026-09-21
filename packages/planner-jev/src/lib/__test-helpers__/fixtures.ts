import type {
  Logger,
  PlannerCandidate,
  PlanningInput,
  StageContext,
  ValidateCandidate,
} from '@maelstrom-co/engine';
import {
  type ChartRequest,
  ChartRequestSchema,
  MessageId,
  ok,
  SessionId,
  type TilingNode,
  type UpdateReason,
  type Vessel,
  VesselSchema,
} from '@maelstrom-co/protocol';

const EVENT_PARAMETERS = [
  { name: 'title', type: 'string', description: 'Event title' },
  { name: 'time', type: 'string', description: 'Time like 9:00 or 14:30' },
] as const;

const LOCATION = {
  name: 'location',
  type: 'string',
  description: 'City or place to request weather for',
} as const;

const DESTINATION = {
  name: 'destination',
  type: 'string',
  description: 'Name of the destination location',
  enum: ['Studio Vortex HQ', 'Central Station'],
} as const;

const ENTRY_TITLE = {
  name: 'title',
  type: 'string',
  description: 'Title of the entry to open',
} as const;

/**
 * Demo-like catalog: variants with different minimum sizes, transition
 * actions with and without parameters, enum, number, boolean, optional and
 * object parameters.
 */
export const vessels: readonly Vessel[] = [
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Calendar with month, week and day views',
    defaultVariant: 'month',
    variants: {
      month: {
        props: {},
        minSize: { width: 4, height: 4 },
        actions: [
          {
            name: 'showWeek',
            description: 'Switch to week view',
            transitionsTo: 'week',
          },
          {
            name: 'addEvent',
            description: "Add an event to today's schedule",
            parameters: [...EVENT_PARAMETERS],
            transitionsTo: 'day',
          },
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
            name: 'addEvent',
            description: "Add an event to today's schedule",
            parameters: [...EVENT_PARAMETERS],
          },
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
            name: 'addEvent',
            description: "Add an event to today's schedule",
            parameters: [...EVENT_PARAMETERS],
          },
        ],
      },
    },
  },
  {
    id: 'weather',
    name: 'Weather',
    description: 'Current conditions or a weekly forecast',
    defaultVariant: 'current',
    variants: {
      current: {
        props: {},
        minSize: { width: 6, height: 4 },
        actions: [
          {
            name: 'setLocation',
            description: 'Load weather for a place',
            parameters: [LOCATION],
          },
          {
            name: 'showWeekly',
            description: 'Show the weekly forecast',
            transitionsTo: 'weekly',
          },
        ],
      },
      weekly: {
        props: {},
        minSize: { width: 8, height: 3 },
        actions: [
          {
            name: 'setLocation',
            description: 'Load weather for a place',
            parameters: [LOCATION],
          },
          {
            name: 'showCurrent',
            description: 'Show current conditions',
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
        minSize: { width: 3, height: 3 },
        actions: [
          {
            name: 'addTask',
            description: 'Add a new task',
            parameters: [
              { name: 'title', type: 'string', description: 'Task title' },
              {
                name: 'urgent',
                type: 'boolean',
                description: 'Whether the task is urgent',
                required: false,
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
                enum: ['Buy milk', 'Send invoice', 7, null],
              },
            ],
          },
          {
            name: 'setLimit',
            description: 'Limit how many tasks are shown',
            parameters: [
              {
                name: 'count',
                type: 'number',
                description: 'How many tasks to show',
              },
            ],
          },
          {
            name: 'importTasks',
            description: 'Import tasks from a structured payload',
            parameters: [
              {
                name: 'payload',
                type: 'object',
                description: 'Tasks to import',
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
    description: 'Saved places and routes',
    defaultVariant: 'overview',
    variants: {
      overview: {
        props: {},
        minSize: { width: 4, height: 4 },
        actions: [
          {
            name: 'showRoute',
            description: 'Show driving directions to a destination',
            parameters: [DESTINATION],
            transitionsTo: 'route',
          },
        ],
      },
      route: {
        props: {},
        minSize: { width: 6, height: 4 },
        actions: [
          {
            name: 'showOverview',
            description: 'Show all saved places',
            transitionsTo: 'overview',
          },
          {
            name: 'showRoute',
            description: 'Show driving directions to a destination',
            parameters: [DESTINATION],
          },
        ],
      },
    },
  },
  {
    id: 'journal',
    name: 'Journal',
    description: 'Journal entries',
    defaultVariant: 'list',
    variants: {
      list: {
        props: {},
        minSize: { width: 3, height: 3 },
        actions: [
          {
            name: 'openEntry',
            description: 'Open an existing entry by title',
            parameters: [ENTRY_TITLE],
            transitionsTo: 'entry',
          },
        ],
      },
      entry: {
        props: {},
        minSize: { width: 16, height: 12 },
        actions: [
          {
            name: 'backToList',
            description: 'Return to the entries list',
            transitionsTo: 'list',
          },
        ],
      },
    },
  },
].map((vessel) => VesselSchema.parse(vessel));

/** The default board: calendar, weather and tasks visible in a row; map and journal hidden. */
export const DEFAULT_TREE: readonly TilingNode[] = [
  'V:1,1,1',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
] as TilingNode[];

export interface RequestOptions {
  readonly tree?: readonly (string | null)[];
  readonly variants?: Readonly<Record<string, string>>;
  readonly columns?: number;
  readonly rows?: number;
  readonly layoutMode?: 'tiling' | 'grid';
  readonly vessels?: readonly Vessel[];
}

/** A request with one `<vessel>-main` instance per Vessel. */
export function makeRequest(
  intent: string | readonly UpdateReason[],
  options: RequestOptions = {},
): ChartRequest {
  const catalog = options.vessels ?? vessels;
  const instances = catalog.map((vessel) => ({
    instanceId: `${vessel.id}-main`,
    vesselId: vessel.id,
    variant: options.variants?.[vessel.id] ?? vessel.defaultVariant,
  }));
  const updateReasons =
    typeof intent === 'string' ? [{ type: 'user_intent', intent }] : intent;
  const layoutMode = options.layoutMode ?? 'tiling';
  return ChartRequestSchema.parse({
    type: 'chart_request',
    context: {
      layoutMode,
      chartDimensions: {
        columns: options.columns ?? 30,
        rows: options.rows ?? 18,
      },
      updateReasons,
    },
    instances,
    vessels: catalog,
    layout:
      layoutMode === 'tiling'
        ? { type: 'tiling', tree: options.tree ?? DEFAULT_TREE, instances }
        : {
            type: 'grid',
            positions: [
              {
                instanceId: 'calendar-main',
                position: { row: 0, column: 0 },
                size: { width: 6, height: 6 },
              },
            ],
          },
  });
}

/** A resize-only request from 30x18 to the given dimensions. */
export function makeResizeRequest(
  columns: number,
  rows: number,
  options: RequestOptions = {},
): ChartRequest {
  return makeRequest(
    [
      {
        type: 'chart_resize',
        previous: { columns: 30, rows: 18 },
        current: { columns, rows },
      },
    ],
    { ...options, columns, rows },
  );
}

export function makeInput(request: ChartRequest): PlanningInput {
  return {
    messageId: MessageId('req-1'),
    sessionId: SessionId('session-1'),
    request,
    history: [],
  };
}

export interface LogEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly msg: string;
  readonly data?: Record<string, unknown>;
  readonly error?: unknown;
}

export function spyLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    logger: {
      debug: (msg, data) => entries.push({ level: 'debug', msg, data }),
      info: (msg, data) => entries.push({ level: 'info', msg, data }),
      warn: (msg, data) => entries.push({ level: 'warn', msg, data }),
      error: (msg, error, data) =>
        entries.push({ level: 'error', msg, error, data }),
    },
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Validation that accepts every candidate unchanged and recommends nothing. */
export const acceptAll: ValidateCandidate = (candidate: PlannerCandidate) =>
  ok({
    ...(candidate as never as object),
    type: 'maelstrom_response',
    requestId: MessageId('req-1'),
    diagnostics: {
      retryHint: { severity: 'none', recommend: false },
      counts: { skippedActions: 0, droppedLayoutEntries: 0, warnings: 0 },
      feedback: '',
    },
  } as never);

export function makeContext(
  input: PlanningInput,
  overrides: {
    readonly logger?: Logger;
    readonly signal?: AbortSignal;
    readonly validate?: ValidateCandidate;
  } = {},
): StageContext {
  return {
    origin: input,
    logger: overrides.logger ?? silentLogger,
    signal: overrides.signal,
    validate: overrides.validate ?? acceptAll,
  };
}
