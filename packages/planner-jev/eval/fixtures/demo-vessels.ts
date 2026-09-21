// Snapshot of apps/demo/src/vessels/{calendar,weather,tasks,map,journal}.vessel.def.ts (after withActionOptions), taken 2026-09-21.
import { type Vessel, VesselSchema } from '@maelstrom-co/protocol';

const DEFINITIONS: readonly unknown[] = [
  {
    id: 'calendar',
    name: 'Calendar',
    description:
      'Calendar widget for viewing dates and scheduling. Supports month view, week view, and day view with hourly time blocks. Every view also supports addEvent, removeEvent, and moveEvent for today\'s schedule — use these whenever the user adds, cancels, or reschedules something for today. Today\'s day view starts with a 7:30 AM "Gym" and a 10:00 AM "Design review — Studio Vortex HQ". When the user asks about getting somewhere or being there by a time, pair with the map vessel\'s showRoute action, passing the event\'s location (e.g. "Studio Vortex HQ") as the destination.',
    defaultVariant: 'month',
    variants: {
      month: {
        props: {},
        minSize: {
          width: 4,
          height: 4,
        },
        actions: [
          {
            name: 'showWeek',
            idempotent: true,
            description: 'Switch to week view for event timeline',
            transitionsTo: 'week',
          },
          {
            name: 'showDay',
            idempotent: true,
            description: 'Switch to day view for hourly schedule',
            transitionsTo: 'day',
          },
          {
            name: 'addEvent',
            description: "Add an event to today's schedule",
            parameters: [
              {
                name: 'title',
                type: 'string',
                description: 'Event title',
              },
              {
                name: 'time',
                type: 'string',
                description: 'Time like 9:00 or 14:30',
              },
            ],
            transitionsTo: 'day',
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
            transitionsTo: 'day',
          },
          {
            name: 'moveEvent',
            description:
              "Reschedule an event on today's schedule to a new time",
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
            transitionsTo: 'day',
          },
        ],
      },
      week: {
        props: {},
        minSize: {
          width: 6,
          height: 3,
        },
        actions: [
          {
            name: 'showMonth',
            idempotent: true,
            description: 'Switch back to month view',
            transitionsTo: 'month',
          },
          {
            name: 'showDay',
            idempotent: true,
            description: 'Switch to day view',
            transitionsTo: 'day',
          },
          {
            name: 'addEvent',
            description: "Add an event to today's schedule",
            parameters: [
              {
                name: 'title',
                type: 'string',
                description: 'Event title',
              },
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
            description:
              "Reschedule an event on today's schedule to a new time",
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
        ],
      },
      day: {
        props: {},
        minSize: {
          width: 4,
          height: 4,
        },
        actions: [
          {
            name: 'showMonth',
            idempotent: true,
            description: 'Switch to month view',
            transitionsTo: 'month',
          },
          {
            name: 'showWeek',
            idempotent: true,
            description: 'Switch to week view',
            transitionsTo: 'week',
          },
          {
            name: 'addEvent',
            description: "Add an event to today's schedule",
            parameters: [
              {
                name: 'title',
                type: 'string',
                description: 'Event title',
              },
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
            description:
              "Reschedule an event on today's schedule to a new time",
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
        ],
      },
    },
  },
  {
    id: 'weather',
    name: 'Weather',
    description:
      'Weather widget showing current conditions or extended forecast. Can display current weather, hourly forecast, or weekly forecast.',
    defaultVariant: 'current',
    variants: {
      current: {
        props: {},
        minSize: {
          width: 6,
          height: 4,
        },
        actions: [
          {
            name: 'setLocation',
            idempotent: true,
            description:
              'Try to load weather for a city or place without assuming the request succeeds',
            parameters: [
              {
                name: 'location',
                type: 'string',
                description: 'City or place to request weather for',
              },
            ],
          },
          {
            name: 'showHourly',
            idempotent: true,
            description: 'Show hourly forecast for today',
            transitionsTo: 'hourly',
          },
          {
            name: 'showWeekly',
            idempotent: true,
            description: 'Show weekly forecast',
            transitionsTo: 'weekly',
          },
        ],
      },
      hourly: {
        props: {},
        minSize: {
          width: 9,
          height: 4,
        },
        actions: [
          {
            name: 'setLocation',
            idempotent: true,
            description:
              'Try to load weather for a city or place without assuming the request succeeds',
            parameters: [
              {
                name: 'location',
                type: 'string',
                description: 'City or place to request weather for',
              },
            ],
          },
          {
            name: 'showCurrent',
            idempotent: true,
            description: 'Show current conditions',
            transitionsTo: 'current',
          },
          {
            name: 'showWeekly',
            idempotent: true,
            description: 'Show weekly forecast',
            transitionsTo: 'weekly',
          },
        ],
      },
      weekly: {
        props: {},
        minSize: {
          width: 8,
          height: 3,
        },
        actions: [
          {
            name: 'setLocation',
            idempotent: true,
            description:
              'Try to load weather for a city or place without assuming the request succeeds',
            parameters: [
              {
                name: 'location',
                type: 'string',
                description: 'City or place to request weather for',
              },
            ],
          },
          {
            name: 'showCurrent',
            idempotent: true,
            description: 'Show current conditions',
            transitionsTo: 'current',
          },
          {
            name: 'showHourly',
            idempotent: true,
            description: 'Show hourly forecast',
            transitionsTo: 'hourly',
          },
        ],
      },
    },
  },
  {
    id: 'tasks',
    name: 'Tasks',
    description:
      'Task list with checkboxes, subtasks, and progress tracking. Supports adding, removing, checking, and nesting tasks.',
    defaultVariant: 'list',
    variants: {
      list: {
        props: {},
        minSize: {
          width: 3,
          height: 3,
        },
        actions: [
          {
            name: 'addTask',
            description: 'Add a new task to the list',
            parameters: [
              {
                name: 'title',
                type: 'string',
                description: 'Task title',
              },
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
  },
  {
    id: 'map',
    name: 'Map',
    description:
      'City map showing saved places and routes. Use this whenever the user asks about getting somewhere, travel time, or directions — including "I need to be at X by Y", "how do I get to X", "when should I leave", or any time an appointment\'s location matters for planning the trip there. Overview shows all locations; route shows directions and travel time to a destination; compact shows a single place card.',
    defaultVariant: 'overview',
    variants: {
      overview: {
        props: {},
        minSize: {
          width: 4,
          height: 4,
        },
        actions: [
          {
            name: 'showRoute',
            idempotent: true,
            description:
              'Show driving directions and travel time to a destination',
            parameters: [
              {
                name: 'destination',
                type: 'string',
                description: 'Name of the destination location',
                enum: [
                  'Home',
                  'Studio Vortex HQ',
                  'Mission High Fitness',
                  'Ritual Coffee',
                ],
              },
            ],
            transitionsTo: 'route',
          },
          {
            name: 'focusLocation',
            idempotent: true,
            description: 'Show a single saved place as a compact card',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: 'Name of the location to focus on',
                enum: [
                  'Home',
                  'Studio Vortex HQ',
                  'Mission High Fitness',
                  'Ritual Coffee',
                ],
              },
            ],
            transitionsTo: 'compact',
          },
        ],
      },
      route: {
        props: {},
        minSize: {
          width: 6,
          height: 4,
        },
        actions: [
          {
            name: 'showOverview',
            idempotent: true,
            description: 'Show all saved locations',
            transitionsTo: 'overview',
          },
          {
            name: 'showRoute',
            idempotent: true,
            description:
              'Show driving directions and travel time to a destination',
            parameters: [
              {
                name: 'destination',
                type: 'string',
                description: 'Name of the destination location',
                enum: [
                  'Home',
                  'Studio Vortex HQ',
                  'Mission High Fitness',
                  'Ritual Coffee',
                ],
              },
            ],
          },
          {
            name: 'focusLocation',
            idempotent: true,
            description: 'Show a single saved place as a compact card',
            parameters: [
              {
                name: 'name',
                type: 'string',
                description: 'Name of the location to focus on',
                enum: [
                  'Home',
                  'Studio Vortex HQ',
                  'Mission High Fitness',
                  'Ritual Coffee',
                ],
              },
            ],
            transitionsTo: 'compact',
          },
        ],
      },
      compact: {
        props: {},
        minSize: {
          width: 3,
          height: 3,
        },
        actions: [
          {
            name: 'showOverview',
            idempotent: true,
            description: 'Show all saved locations',
            transitionsTo: 'overview',
          },
          {
            name: 'showRoute',
            idempotent: true,
            description:
              'Show driving directions and travel time to a destination',
            parameters: [
              {
                name: 'destination',
                type: 'string',
                description: 'Name of the destination location',
                enum: [
                  'Home',
                  'Studio Vortex HQ',
                  'Mission High Fitness',
                  'Ritual Coffee',
                ],
              },
            ],
            transitionsTo: 'route',
          },
        ],
      },
    },
  },
  {
    id: 'journal',
    name: 'Journal',
    description:
      'Personal journal for writing entries. List view shows recent entries, entry view enables scribe mode where the AI can dictate content.',
    defaultVariant: 'list',
    variants: {
      list: {
        props: {},
        minSize: {
          width: 3,
          height: 3,
        },
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
            idempotent: true,
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
        minSize: {
          width: 4,
          height: 4,
        },
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
            idempotent: true,
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
            idempotent: true,
            description: 'Return to the journal entries list',
            transitionsTo: 'list',
          },
        ],
      },
    },
  },
];

/** The five demo Vessels, parsed and branded. */
export const demoVessels: readonly Vessel[] = DEFINITIONS.map((definition) =>
  VesselSchema.parse(definition),
);
