import type { EngineConnector, ConnectorCapabilities, ConnectorEvent, Unsubscribe } from '@maelstrom-co/client';
import type { ChartRequest, MaelstromResponse, TilingLayout } from '@maelstrom-co/protocol-old';

const INITIAL_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: [
    'H',
    'V', 'weather-1', 'notes-1',
    'V', 'calendar-1', 'tasks-1',
  ],
  instances: [
    { instanceId: 'weather-1', vesselId: 'weather', variant: 'compact' },
    { instanceId: 'calendar-1', vesselId: 'calendar', variant: 'month' },
    { instanceId: 'notes-1', vesselId: 'notes', variant: 'default' },
    { instanceId: 'tasks-1', vesselId: 'tasks', variant: 'list' },
  ],
};

const REARRANGED_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: [
    'H',
    'weather-1',
    'V', 'calendar-1',
    'H', 'notes-1', 'tasks-1',
  ],
  instances: [
    { instanceId: 'weather-1', vesselId: 'weather', variant: 'full' },
    { instanceId: 'calendar-1', vesselId: 'calendar', variant: 'week' },
    { instanceId: 'notes-1', vesselId: 'notes', variant: 'default' },
    { instanceId: 'tasks-1', vesselId: 'tasks', variant: 'list' },
  ],
};

// Step 3: Tasks gets prominent placement, other vessels compress
// Step 3: Only tasks visible — maximized
const TASKS_FOCUSED_LAYOUT: TilingLayout = {
  type: 'tiling',
  tree: ['tasks-1'],
  instances: [
    { instanceId: 'tasks-1', vesselId: 'tasks', variant: 'list' },
  ],
};

export const DEMO_PROMPT_1 = 'Show me the weather forecast and expand the calendar to week view';
export const DEMO_PROMPT_2 = 'Expand tasks and add "Review PR #42"';

// DemoStep uses a permissive params type since we're constructing
// wire-format responses (same as JSON.parse would produce from a real engine)
interface DemoStep {
  userMessage: string;
  rationale: string;
  executionPlan: Array<{ instanceId: string; action: string; params?: Record<string, unknown> }>;
  layout: TilingLayout;
}

const DEMO_STEPS: DemoStep[] = [
  {
    userMessage: '',
    rationale: 'Initial layout',
    executionPlan: [],
    layout: INITIAL_LAYOUT,
  },
  {
    userMessage: "Here's your weather forecast with the calendar in week view.",
    rationale: 'Expanded weather to show forecast details. Switched calendar to week view for daily visibility.',
    executionPlan: [],
    layout: REARRANGED_LAYOUT,
  },
  {
    userMessage: 'Done — tasks panel expanded and "Review PR #42" added.',
    rationale: 'Moved tasks to prominent position. Executed addTask action with title. Compressed weather and calendar.',
    executionPlan: [
      { instanceId: 'tasks-1', action: 'addTask', params: { title: 'Review PR #42' } },
    ],
    layout: TASKS_FOCUSED_LAYOUT,
  },
];

export class DemoConnector implements EngineConnector {
  readonly capabilities: ConnectorCapabilities = { voice: false, streaming: false, stateful: true };
  private requestCount = 0;

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async process(request: ChartRequest): Promise<MaelstromResponse> {
    this.requestCount++;
    const stepIndex = Math.min(this.requestCount - 1, DEMO_STEPS.length - 1);
    const step = DEMO_STEPS[stepIndex];

    // Simulate engine delay for non-initial calls
    if (this.requestCount > 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    // Cast: we're simulating wire-format data (same as JSON.parse from a real engine)
    return {
      type: 'maelstrom_response',
      requestId: request.id,
      userMessage: step.userMessage,
      rationale: step.rationale,
      executionPlan: step.executionPlan,
      layout: step.layout,
    } as MaelstromResponse;
  }

  subscribe(_handler: (event: ConnectorEvent) => void): Unsubscribe {
    return () => {};
  }

  reset(): void {
    this.requestCount = 0;
  }
}
