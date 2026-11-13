import { AguiWorkspaceClient } from '@maelstrom-co/agui';
import type {
  ApplicationSettlement,
  AssistantMessage,
  ConnectorEvent,
  EngineConnector,
  Orchestrator,
} from '@maelstrom-co/client';
import type {
  ChartRequestMessage,
  MaelstromResponse,
  SessionId,
} from '@maelstrom-co/protocol';

import type { WorkspaceExchange } from '../contracts';

export class WorkspaceConnector implements EngineConnector {
  readonly capabilities = { voice: false, streaming: false, stateful: true };
  readonly workspace = new AguiWorkspaceClient(55_000);
  private readonly listeners = new Set<(event: ConnectorEvent) => void>();
  private readonly lifetime = new AbortController();
  private binding?: SessionId;
  private currentTool?: {
    id: string;
    intent: string;
    requestId?: string;
    settlement?: ApplicationSettlement;
  };
  private requestToolId?: string;
  private observation?: ApplicationSettlement['chartRequest'];
  private plan?: MaelstromResponse;
  private claimed = new Set<number>();

  constructor(
    private readonly exchange: (
      input: WorkspaceExchange,
      signal: AbortSignal,
    ) => Promise<readonly unknown[]>,
  ) {}

  async connect(sessionId: SessionId) {
    if (this.lifetime.signal.aborted)
      throw new Error('Workspace binding retired.');
    if (this.binding) {
      if (this.binding !== sessionId)
        throw new Error('Workspace binding changed.');
      return;
    }
    this.binding = sessionId;
    this.workspace.open((frame) => {
      const input = {
        frame,
        toolCallId: this.requestToolId,
        observation: this.observation,
      };
      const signal = AbortSignal.any([
        this.lifetime.signal,
        AbortSignal.timeout(55_000),
      ]);
      void this.exchange(input, signal)
        .then((events) => {
          if (signal.aborted) return;
          for (const event of events)
            this.workspace.receive(JSON.stringify(event), true);
        })
        .catch(() => this.stop());
    }, sessionId);
  }

  private stop() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    this.workspace.disconnect();
    for (const listener of this.listeners)
      listener({
        type: 'disconnected',
        clean: false,
        retryable: false,
        message: 'Workspace stopped. Reconcile before continuing.',
      });
  }

  async disconnect() {
    this.stop();
  }

  subscribe(listener: (event: ConnectorEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async addAssistantMessage(_message: AssistantMessage) {
    throw new Error('The goal runtime owns conversation history.');
  }

  async getHistory() {
    return [];
  }

  async process(message: ChartRequestMessage) {
    const intents = message.request.context.updateReasons.filter(
      (reason) => reason.type === 'user_intent',
    );
    const tool = this.currentTool;
    if (
      intents.length &&
      (!tool ||
        intents.length !== 1 ||
        intents[0].intent !== tool.intent ||
        tool.requestId)
    ) {
      this.stop();
      throw new Error('Unmatched workspace intent.');
    }
    this.requestToolId = intents.length ? tool?.id : undefined;
    if (intents.length && tool) tool.requestId = message.id;
    try {
      const response = await this.workspace.process(message);
      this.plan = response;
      this.claimed.clear();
      return response;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  claimAction(instanceId: string, action: string) {
    if (this.lifetime.signal.aborted || !this.plan)
      throw new Error('No active application plan.');
    const index = this.plan.executionPlan.findIndex(
      (item, index) =>
        !this.claimed.has(index) &&
        item.instanceId === instanceId &&
        item.action === action,
    );
    if (index < 0)
      throw new Error('Action was not issued or was already executed.');
    this.claimed.add(index);
    return { requestId: this.plan.requestId, index };
  }

  async applicationSettled(
    settlement: ApplicationSettlement,
    signal?: AbortSignal,
  ) {
    if (
      this.plan?.requestId !== settlement.requestId ||
      !settlement.chartRequest
    ) {
      this.stop();
      throw new Error('Missing canonical application observation.');
    }
    this.observation = settlement.chartRequest;
    try {
      await this.workspace.applicationSettled(settlement, signal);
      if (
        this.lifetime.signal.aborted ||
        signal?.aborted ||
        this.workspace.snapshot()
      )
        throw new Error('Workspace application stopped.');
      if (this.currentTool?.requestId === settlement.requestId)
        this.currentTool.settlement = structuredClone(settlement);
      this.plan = undefined;
      this.requestToolId = undefined;
    } catch (error) {
      this.stop();
      throw error;
    } finally {
      this.observation = undefined;
    }
  }

  async apply(orchestrator: Orchestrator, callId: string, intent: string) {
    if (this.currentTool || this.lifetime.signal.aborted)
      throw new Error('Workspace is unavailable.');
    const tool: NonNullable<WorkspaceConnector['currentTool']> = {
      id: callId,
      intent,
    };
    this.currentTool = tool;
    const scope = orchestrator.createIntentScope();
    try {
      const ticket = orchestrator.enqueueIntent(intent, { scope });
      if (!ticket.accepted)
        throw new Error('Workspace intent was not admitted.');
      const result = await ticket.result;
      if (
        result.status !== 'applied' ||
        !tool.settlement ||
        tool.settlement.requestId !== result.response.requestId ||
        this.lifetime.signal.aborted
      ) {
        throw new Error(
          'Workspace outcome is not confirmed. Do not retry automatically.',
        );
      }
      return tool.settlement;
    } catch (error) {
      this.stop();
      throw error;
    } finally {
      scope.retire();
      this.currentTool = undefined;
    }
  }
}
