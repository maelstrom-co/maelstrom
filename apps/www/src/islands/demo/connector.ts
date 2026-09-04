import {
  ActionName,
  InstanceId,
  type TilingLayout,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import {
  buildScriptedSteps,
  ScriptedConnector,
  type StepMeta,
} from '../shared/ScriptedConnector';

const WEATHER_ID = InstanceId('weather-1');
const CALENDAR_ID = InstanceId('calendar-1');
const NOTES_ID = InstanceId('notes-1');
const TASKS_ID = InstanceId('tasks-1');

const WEATHER = tilingLeafToken(WEATHER_ID);
const CALENDAR = tilingLeafToken(CALENDAR_ID);
const NOTES = tilingLeafToken(NOTES_ID);
const TASKS = tilingLeafToken(TASKS_ID);

type Inst = TilingLayout['instances'][number];

const weatherCompact: Inst = {
  instanceId: WEATHER_ID,
  vesselId: VesselId('weather'),
  variant: VariantName('compact'),
};
const weatherFull: Inst = {
  instanceId: WEATHER_ID,
  vesselId: VesselId('weather'),
  variant: VariantName('full'),
};
const calendarMonth: Inst = {
  instanceId: CALENDAR_ID,
  vesselId: VesselId('calendar'),
  variant: VariantName('month'),
};
const calendarWeek: Inst = {
  instanceId: CALENDAR_ID,
  vesselId: VesselId('calendar'),
  variant: VariantName('week'),
};
const notesDefault: Inst = {
  instanceId: NOTES_ID,
  vesselId: VesselId('notes'),
  variant: VariantName('default'),
};
const tasksList: Inst = {
  instanceId: TASKS_ID,
  vesselId: VesselId('tasks'),
  variant: VariantName('list'),
};

// Desktop: 2D tiling shows all four vessels rearranging in place.
const DESKTOP_LAYOUTS: TilingLayout[] = [
  {
    type: 'tiling',
    tree: ['H', 'V', WEATHER, NOTES, 'V', CALENDAR, TASKS],
    instances: [weatherCompact, calendarMonth, notesDefault, tasksList],
  },
  {
    type: 'tiling',
    tree: ['H', WEATHER, 'V', CALENDAR, 'H', NOTES, TASKS],
    instances: [weatherFull, calendarWeek, notesDefault, tasksList],
  },
  {
    type: 'tiling',
    tree: [TASKS],
    instances: [tasksList],
  },
];

// Mobile: a single column only fits ~2 cards at a readable size, so each step
// shows the two most relevant for its prompt instead of squeezing all four into
// nested tiles. All four still appear across the cycle.
const MOBILE_LAYOUTS: TilingLayout[] = [
  {
    type: 'tiling',
    tree: ['H', WEATHER, NOTES],
    instances: [weatherCompact, notesDefault],
  },
  {
    type: 'tiling',
    tree: ['H', WEATHER, CALENDAR],
    instances: [weatherFull, calendarWeek],
  },
  {
    type: 'tiling',
    tree: ['H', TASKS, CALENDAR],
    instances: [tasksList, calendarWeek],
  },
];

// Prompts/rationales/actions are layout-independent; only the tiling differs per
// breakpoint, so the steps are assembled from this shared metadata.
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
        action: ActionName('addTask'),
        params: { title: 'Review PR #42' },
      },
    ],
  },
];

/** Build a demo connector whose layouts match the breakpoint. */
export const createDemoConnector = (isMobile = false): ScriptedConnector =>
  new ScriptedConnector(
    buildScriptedSteps(STEP_META, isMobile ? MOBILE_LAYOUTS : DESKTOP_LAYOUTS),
  );

/** Desktop steps — exposed for tests. */
export const DEMO_STEPS = buildScriptedSteps(STEP_META, DESKTOP_LAYOUTS);
