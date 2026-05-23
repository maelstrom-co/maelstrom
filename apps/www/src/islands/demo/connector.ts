import { InstanceId, type TilingLayout } from '@maelstrom-co/protocol';
import {
  ScriptedConnector,
  type ScriptedStep,
} from '../shared/ScriptedConnector';

const WEATHER_ID = InstanceId('weather-1');
const CALENDAR_ID = InstanceId('calendar-1');
const NOTES_ID = InstanceId('notes-1');
const TASKS_ID = InstanceId('tasks-1');

const INITIAL_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: ['H', 'V', WEATHER_ID, NOTES_ID, 'V', CALENDAR_ID, TASKS_ID],
  instances: [
    { instanceId: WEATHER_ID, vesselId: 'weather', variant: 'compact' },
    { instanceId: CALENDAR_ID, vesselId: 'calendar', variant: 'month' },
    { instanceId: NOTES_ID, vesselId: 'notes', variant: 'default' },
    { instanceId: TASKS_ID, vesselId: 'tasks', variant: 'list' },
  ],
};

const REARRANGED_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: ['H', WEATHER_ID, 'V', CALENDAR_ID, 'H', NOTES_ID, TASKS_ID],
  instances: [
    { instanceId: WEATHER_ID, vesselId: 'weather', variant: 'full' },
    { instanceId: CALENDAR_ID, vesselId: 'calendar', variant: 'week' },
    { instanceId: NOTES_ID, vesselId: 'notes', variant: 'default' },
    { instanceId: TASKS_ID, vesselId: 'tasks', variant: 'list' },
  ],
};

const TASKS_FOCUSED_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: [TASKS_ID],
  instances: [{ instanceId: TASKS_ID, vesselId: 'tasks', variant: 'list' }],
};

export const DEMO_STEPS: ScriptedStep[] = [
  {
    userMessage: '',
    rationale: 'Initial layout',
    executionPlan: [],
    layout: INITIAL_LAYOUT,
  },
  {
    prompt: 'Show me the weather forecast and expand the calendar to week view',
    userMessage: "Here's your weather forecast with the calendar in week view.",
    rationale:
      'Expanded weather to show forecast details. Switched calendar to week view for daily visibility.',
    executionPlan: [],
    layout: REARRANGED_LAYOUT,
  },
  {
    prompt: 'Expand tasks and add "Review PR #42"',
    userMessage: 'Done — tasks panel expanded and "Review PR #42" added.',
    rationale:
      'Moved tasks to prominent position. Executed addTask action with title. Compressed weather and calendar.',
    executionPlan: [
      {
        instanceId: TASKS_ID,
        action: 'addTask',
        params: { title: 'Review PR #42' },
      },
    ],
    layout: TASKS_FOCUSED_LAYOUT,
  },
];

export class DemoConnector extends ScriptedConnector {
  constructor() {
    super(DEMO_STEPS);
  }
}
