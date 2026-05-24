import type {
  AssistantMessage,
  ConnectorCapabilities,
  ConnectorEvent,
  EngineConnector,
  Unsubscribe,
} from '@maelstrom-co/client';
import type {
  ActionExecution,
  ChartRequestMessage,
  MaelstromResponse,
  SessionHistoryEntry,
  SessionId,
  TilingLayout,
} from '@maelstrom-co/protocol';
import {
  ActionName,
  InstanceId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

const WEATHER_ID = InstanceId('weather-1');
const CALENDAR_ID = InstanceId('calendar-1');
const NOTES_ID = InstanceId('notes-1');
const TASKS_ID = InstanceId('tasks-1');

interface DemoStep {
  /** The user prompt that triggers this step. Undefined for the initial layout. */
  prompt?: string;
  userMessage: string;
  rationale: string;
  executionPlan: readonly ActionExecution[];
  layout: TilingLayout;
}

const INITIAL_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: ['H', 'V', WEATHER_ID, NOTES_ID, 'V', CALENDAR_ID, TASKS_ID],
  instances: [
    { instanceId: WEATHER_ID, vesselId: VesselId('weather'), variant: VariantName('compact') },
    { instanceId: CALENDAR_ID, vesselId: VesselId('calendar'), variant: VariantName('month') },
    { instanceId: NOTES_ID, vesselId: VesselId('notes'), variant: VariantName('default') },
    { instanceId: TASKS_ID, vesselId: VesselId('tasks'), variant: VariantName('list') },
  ],
};

const REARRANGED_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: ['H', WEATHER_ID, 'V', CALENDAR_ID, 'H', NOTES_ID, TASKS_ID],
  instances: [
    { instanceId: WEATHER_ID, vesselId: VesselId('weather'), variant: VariantName('full') },
    { instanceId: CALENDAR_ID, vesselId: VesselId('calendar'), variant: VariantName('week') },
    { instanceId: NOTES_ID, vesselId: VesselId('notes'), variant: VariantName('default') },
    { instanceId: TASKS_ID, vesselId: VesselId('tasks'), variant: VariantName('list') },
  ],
};

const TASKS_FOCUSED_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: [TASKS_ID],
  instances: [{ instanceId: TASKS_ID, vesselId: VesselId('tasks'), variant: VariantName('list') }],
};

export const DEMO_STEPS: DemoStep[] = [
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
        action: ActionName('addTask'),
        params: { title: 'Review PR #42' },
      },
    ],
    layout: TASKS_FOCUSED_LAYOUT,
  },
];

export class DemoConnector implements EngineConnector {
  readonly capabilities: ConnectorCapabilities = {
    voice: false,
    streaming: false,
    stateful: true,
  };
  private requestCount = 0;

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
    this.requestCount++;
    const stepIndex = Math.min(this.requestCount - 1, DEMO_STEPS.length - 1);
    const step = DEMO_STEPS[stepIndex];

    // Simulate engine delay for non-initial calls
    if (this.requestCount > 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    return {
      type: 'maelstrom_response',
      requestId: message.id,
      userMessage: step.userMessage,
      rationale: step.rationale,
      executionPlan: step.executionPlan,
      layout: step.layout,
    };
  }

  async addAssistantMessage(_message: AssistantMessage): Promise<void> {
    // no-op for demo
  }

  async getHistory(
    _sessionId: SessionId,
  ): Promise<readonly SessionHistoryEntry[]> {
    return [];
  }

  subscribe(_handler: (event: ConnectorEvent) => void): Unsubscribe {
    return () => {};
  }

  reset(): void {
    this.requestCount = 0;
  }
}
