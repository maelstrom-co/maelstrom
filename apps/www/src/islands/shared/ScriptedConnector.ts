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

/** One pre-recorded turn the connector replays in order. */
export interface ScriptedStep {
  /** Prompt that triggers this step. Undefined for the initial layout. */
  prompt?: string;
  userMessage: string;
  rationale: string;
  executionPlan: readonly ActionExecution[];
  layout: TilingLayout;
}

/**
 * Deterministic connector that replays a fixed list of steps in order — one per
 * request — with a simulated engine delay on non-initial calls. Shared by the
 * site's scripted demos (hero, "See It In Action"); each supplies its own steps
 * and vessels.
 */
export class ScriptedConnector implements EngineConnector {
  readonly capabilities: ConnectorCapabilities = {
    voice: false,
    streaming: false,
    stateful: true,
  };
  private requestCount = 0;

  constructor(
    private readonly steps: readonly ScriptedStep[],
    private readonly delayMs = 1200,
  ) {}

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
    this.requestCount++;
    const stepIndex = Math.min(this.requestCount - 1, this.steps.length - 1);
    const step = this.steps[stepIndex];

    // Simulate engine latency for non-initial calls.
    if (this.requestCount > 1) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
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

  async addAssistantMessage(_message: AssistantMessage): Promise<void> {}

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
