import { calendarVessel as baseCalendar } from '@maelstrom-co/demo-vessels/vessels/calendar.vessel.def';
import { journalVessel as baseJournal } from '@maelstrom-co/demo-vessels/vessels/journal.vessel.def';
import { tasksVessel as baseTasks } from '@maelstrom-co/demo-vessels/vessels/tasks.vessel.def';
import {
  defineVessel,
  type VesselActionDefinition,
} from '@maelstrom-co/protocol';

export { labsVessel } from '@maelstrom-co/demo-vessels/vessels/labs.vessel.def';
export { mapVessel } from '@maelstrom-co/demo-vessels/vessels/map.vessel.def';
export { weatherVessel } from '@maelstrom-co/demo-vessels/vessels/weather.vessel.def';

const target = [
  {
    name: 'id',
    type: 'string',
    required: true,
    description: 'Exact record ID from the current authorized records.',
  },
  {
    name: 'version',
    type: 'number',
    required: true,
    description: 'Exact observed record version.',
  },
] as const;
const title = {
  name: 'title',
  type: 'string',
  required: true,
  description: 'Record title.',
} as const;
const date = {
  name: 'date',
  type: 'string',
  required: true,
  description: 'Absolute calendar date, YYYY-MM-DD.',
} as const;
const schedule = [
  date,
  {
    name: 'time',
    type: 'string',
    required: true,
    description: 'Local time in HH:mm, using 24-hour notation.',
  },
  {
    name: 'timeZone',
    type: 'string',
    required: true,
    description: 'IANA timezone, such as America/Montevideo.',
  },
] as const;

const actions = {
  createEntry: {
    name: 'createEntry',
    description:
      'Create an empty dated Journal entry. Append content in a subsequent workspace tool call using the returned ID/version.',
    parameters: [title, date],
  },
  openEntry: {
    name: 'openEntry',
    description: 'Select the exact observed Journal entry.',
    parameters: target,
    effect: 'idempotent',
  },
  writeContent: {
    name: 'writeContent',
    description:
      'Append text to the exact observed Journal entry and select it.',
    parameters: [
      ...target,
      {
        name: 'text',
        type: 'string',
        required: true,
        description: 'Text to append.',
      },
    ],
  },
  addTask: {
    name: 'addTask',
    description: 'Create an incomplete task.',
    parameters: [title],
  },
  removeTask: {
    name: 'removeTask',
    description: 'Remove the exact observed task.',
    parameters: target,
  },
  checkTask: {
    name: 'checkTask',
    description: 'Complete the exact observed task.',
    parameters: target,
    effect: 'idempotent',
  },
  uncheckTask: {
    name: 'uncheckTask',
    description: 'Reopen the exact observed task.',
    parameters: target,
    effect: 'idempotent',
  },
  addSubtask: {
    name: 'addSubtask',
    description: 'Add an incomplete subtask to the exact observed task.',
    parameters: [
      ...target,
      {
        name: 'subtaskTitle',
        type: 'string',
        required: true,
        description: 'Subtask title.',
      },
    ],
  },
  addEvent: {
    name: 'addEvent',
    description: 'Create an event on an absolute date in an explicit timezone.',
    parameters: [title, ...schedule],
  },
  removeEvent: {
    name: 'removeEvent',
    description: 'Remove the exact observed Calendar event.',
    parameters: target,
  },
  moveEvent: {
    name: 'moveEvent',
    description: 'Reschedule the exact observed Calendar event.',
    parameters: [...target, ...schedule],
    effect: 'idempotent',
  },
} as const satisfies Record<string, VesselActionDefinition>;

function recordActions<const T extends readonly VesselActionDefinition[]>(
  original: T,
) {
  const replacements: Readonly<Record<string, VesselActionDefinition>> =
    actions;
  return original.map((action) => ({
    ...action,
    ...replacements[action.name],
  })) as {
    [I in keyof T]: T[I] extends { name: infer N extends keyof typeof actions }
      ? Omit<T[I], keyof (typeof actions)[N]> & (typeof actions)[N]
      : T[I];
  };
}

export const journalVessel = defineVessel({
  ...baseJournal,
  description:
    'Workspace-owned dated Journal entries. Target existing records by their exact observed ID and version. Each workspace tool call permits one application-effect Action. A create and a dependent append require separate tool calls.',
  variants: {
    list: {
      ...baseJournal.variants.list,
      actions: recordActions(baseJournal.variants.list.actions),
    },
    entry: {
      ...baseJournal.variants.entry,
      actions: recordActions(baseJournal.variants.entry.actions),
    },
  },
});
export const tasksVessel = defineVessel({
  ...baseTasks,
  description:
    'Workspace-owned tasks and subtasks. Existing task mutations require the exact observed ID and version. Each workspace tool call permits one application-effect Action.',
  variants: {
    list: {
      ...baseTasks.variants.list,
      actions: recordActions(baseTasks.variants.list.actions),
    },
  },
});
export const calendarVessel = defineVessel({
  ...baseCalendar,
  description:
    'Workspace-owned Calendar events with absolute dates, local times, and IANA timezones. There are no seeded events. Existing event mutations require their exact observed ID and version. Each workspace tool call permits one application-effect Action.',
  variants: {
    month: {
      ...baseCalendar.variants.month,
      actions: recordActions(baseCalendar.variants.month.actions),
    },
    week: {
      ...baseCalendar.variants.week,
      actions: recordActions(baseCalendar.variants.week.actions),
    },
    day: {
      ...baseCalendar.variants.day,
      actions: recordActions(baseCalendar.variants.day.actions),
    },
  },
});
