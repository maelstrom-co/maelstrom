import { InstanceId, type TilingLayout } from '@maelstrom-co/protocol';
import {
  ScriptedConnector,
  type ScriptedStep,
} from '../shared/ScriptedConnector';

const WEATHER_ID = InstanceId('weather-1');
const CALENDAR_ID = InstanceId('calendar-1');
const NOTES_ID = InstanceId('notes-1');
const TASKS_ID = InstanceId('tasks-1');

type Inst = TilingLayout['instances'][number];

const weatherCompact: Inst = {
  instanceId: WEATHER_ID,
  vesselId: 'weather',
  variant: 'compact',
};
const weatherFull: Inst = {
  instanceId: WEATHER_ID,
  vesselId: 'weather',
  variant: 'full',
};
const calendarMonth: Inst = {
  instanceId: CALENDAR_ID,
  vesselId: 'calendar',
  variant: 'month',
};
const calendarWeek: Inst = {
  instanceId: CALENDAR_ID,
  vesselId: 'calendar',
  variant: 'week',
};
const notesDefault: Inst = {
  instanceId: NOTES_ID,
  vesselId: 'notes',
  variant: 'default',
};
const tasksList: Inst = {
  instanceId: TASKS_ID,
  vesselId: 'tasks',
  variant: 'list',
};

// Desktop: 2D tiling shows all four vessels rearranging in place.
const DESKTOP_LAYOUTS: TilingLayout[] = [
  {
    type: 'tiling',
    tree: ['H', 'V', WEATHER_ID, NOTES_ID, 'V', CALENDAR_ID, TASKS_ID],
    instances: [weatherCompact, calendarMonth, notesDefault, tasksList],
  },
  {
    type: 'tiling',
    tree: ['H', WEATHER_ID, 'V', CALENDAR_ID, 'H', NOTES_ID, TASKS_ID],
    instances: [weatherFull, calendarWeek, notesDefault, tasksList],
  },
  {
    type: 'tiling',
    tree: [TASKS_ID],
    instances: [tasksList],
  },
];

// Mobile: a single column only fits ~2 cards at a readable size, so each step
// shows the two most relevant for its prompt instead of squeezing all four into
// nested tiles. All four still appear across the cycle.
const MOBILE_LAYOUTS: TilingLayout[] = [
  {
    type: 'tiling',
    tree: ['H', WEATHER_ID, NOTES_ID],
    instances: [weatherCompact, notesDefault],
  },
  {
    type: 'tiling',
    tree: ['H', WEATHER_ID, CALENDAR_ID],
    instances: [weatherFull, calendarWeek],
  },
  {
    type: 'tiling',
    tree: ['H', TASKS_ID, CALENDAR_ID],
    instances: [tasksList, calendarWeek],
  },
];

// Prompts/rationales/actions are layout-independent; only the tiling differs per
// breakpoint, so the steps are assembled from this shared metadata.
type StepMeta = Omit<ScriptedStep, 'layout'>;

const STEP_META: StepMeta[] = [
  { userMessage: '', rationale: 'Initial layout', executionPlan: [] },
  {
    prompt: 'Show me the weather forecast and expand the calendar to week view',
    userMessage: "Here's your weather forecast with the calendar in week view.",
    rationale:
      'Expanded weather to show forecast details. Switched calendar to week view for daily visibility.',
    executionPlan: [],
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
  },
];

const buildSteps = (layouts: TilingLayout[]): ScriptedStep[] =>
  STEP_META.map((meta, i) => ({ ...meta, layout: layouts[i] }));

/** Build a demo connector whose layouts match the breakpoint. */
export const createDemoConnector = (isMobile = false): ScriptedConnector =>
  new ScriptedConnector(buildSteps(isMobile ? MOBILE_LAYOUTS : DESKTOP_LAYOUTS));

/** Desktop steps — exposed for the script driver's prompts/rationales. */
export const DEMO_STEPS: ScriptedStep[] = buildSteps(DESKTOP_LAYOUTS);

export class DemoConnector extends ScriptedConnector {
  constructor() {
    super(DEMO_STEPS);
  }
}
