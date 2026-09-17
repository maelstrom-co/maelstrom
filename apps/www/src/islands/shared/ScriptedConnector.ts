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
 * A scripted step minus its layout — the breakpoint-independent metadata
 * (prompt, messages, actions). Each connector pairs one list of these with its
 * per-breakpoint layouts via {@link buildScriptedSteps}.
 */
export type StepMeta = Omit<ScriptedStep, 'layout'>;

/** A non-empty step list, so `process` always has a step to return. */
export type ScriptedSteps = readonly [ScriptedStep, ...ScriptedStep[]];

/**
 * Pair breakpoint-independent step metadata with per-breakpoint layouts. The two
 * lists are positional and must be the same non-zero length; a mismatch throws
 * rather than silently yielding a step with an undefined layout.
 */
export function buildScriptedSteps(
  meta: readonly StepMeta[],
  layouts: readonly TilingLayout[],
): ScriptedSteps {
  if (meta.length === 0) {
    throw new Error('buildScriptedSteps: needs at least one step');
  }
  if (meta.length !== layouts.length) {
    throw new Error(
      `buildScriptedSteps: ${meta.length} steps need ${meta.length} layouts, got ${layouts.length}`,
    );
  }
  // Safe: the guards above prove the result is the same non-zero length as meta.
  return meta.map((m, i) => ({
    ...m,
    layout: layouts[i],
  })) as unknown as ScriptedSteps;
}

/**
 * Deterministic connector that replays a fixed list of steps in order — one per
 * request — with a simulated engine delay on non-initial calls. Shared by the
 * site's scripted demos (hero, "See It In Action"); each supplies its own steps
 * and vessels. `steps` is exposed so the demo driver can derive its typed script
 * from the same source it replays (no separate, desyncable script list).
 */
export class ScriptedConnector implements EngineConnector {
  readonly capabilities: ConnectorCapabilities = {
    voice: false,
    streaming: false,
    stateful: true,
  };
  private requestCount = 0;

  constructor(
    readonly steps: ScriptedSteps,
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
      ...nonBlankPresentation(step.userMessage, 'userMessage'),
      ...nonBlankPresentation(step.rationale, 'rationale'),
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

function nonBlankPresentation(
  value: string,
  key: 'userMessage' | 'rationale',
): Partial<Pick<MaelstromResponse, typeof key>> {
  return value.trim().length > 0 ? { [key]: value } : {};
}
