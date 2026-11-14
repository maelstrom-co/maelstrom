import {
  AGENT_WIRE_VERSION,
  type AgentActionOutcome,
  type AgentEvent,
  type AgentUiAppliedInput,
  type AgentUiChangeEvent,
  type ChartRequest,
  type MaelstromResponse,
  MessageId,
  toError,
} from '@maelstrom-co/protocol';

import type { ActionRecord } from '../command-processor/action-runner.types.js';
import type { CommandBatchResult } from '../command-processor/command-batch-result.js';
import type {
  ConnectorEvent,
  EngineConnector,
} from '../connection-manager/connector.types.js';
import type { DiagnosticChannel } from '../diagnostic-channel.js';
import type { Unsubscribe } from '../types.js';
import type { Logger } from '../utils/logger.js';
import { type EventSubscriber, TypedEmitter } from '../utils/typed-emitter.js';
import type {
  AgentConversationEvents,
  SendMessageOptions,
} from './conversation-event.types.js';
import { orderActionOutcomes } from './order-action-outcomes.js';
import { type StaleSubject, StaleRunWatch } from './stale-run-watch.js';

/**
 * Settlement of one agent-authored response batch, with the per-Action records
 * when the Actions ran and the Chart as the batch left it. `actions` is absent
 * when the batch never reached its Actions, such as a refused Layout.
 */
export type SettledAgentChange = {
  /** Outcome of the batch as a whole. */
  readonly batch: CommandBatchResult;
  /** Records of the executed Actions, when the Actions ran. */
  readonly actions: readonly ActionRecord[] | undefined;
  /**
   * Chart snapshot taken when the batch settled, before any later queued
   * batch ran. Absent when the batch never reached the command queue.
   */
  readonly chart: ChartRequest | undefined;
};

/**
 * Reports why captured work must be dropped, or `null` while it still belongs
 * to the live connector and a live Orchestrator.
 */
export type FenceCheck = (detail?: string) => string | null;

/** Narrow capabilities the agent conversation borrows from the Orchestrator. */
export type AgentConversationDependencies = {
  /** The connector currently in use. */
  readonly currentConnector: () => EngineConnector;
  /** Builds a Chart snapshot of the board as it stands now. */
  readonly buildChart: () => ChartRequest;
  /** Applies a response as one settled batch, Layout first, then Actions. */
  readonly dispatchChange: (
    response: MaelstromResponse,
  ) => Promise<SettledAgentChange>;
  /** Captures a fence that trips on disposal or a connector swap. */
  readonly captureFence: (subject: string) => FenceCheck;
  /** Receives warnings about acknowledgements that could not be delivered. */
  readonly logger: Logger;
  /** Silence window after which an input or Agent Run counts as stale. */
  readonly agentRunStaleTimeoutMs: number;
  /** Receives metadata-only observations of agent inputs as they are sent. */
  readonly diagnostics: Pick<DiagnosticChannel, 'emit'>;
  /** Reads a monotonic clock in milliseconds to time UI change acknowledgements. */
  readonly now: () => number;
};

type Attachment = {
  readonly connector: EngineConnector;
  readonly release: Unsubscribe;
};

/**
 * The Agent Session conversation over the current connector: surfaces agent
 * events, applies UI changes and acknowledges them, and reports when the
 * conversation is lost.
 */
export class AgentConversation {
  readonly #dependencies: AgentConversationDependencies;
  readonly #events = new TypedEmitter<AgentConversationEvents>();
  readonly #staleRunWatch: StaleRunWatch;
  #attachment: Attachment | null = null;
  #conversationExists = false;
  #pendingUtterances = 0;
  #sessionGeneration = 0;

  /** Creates a detached conversation. Call {@link attach} to start listening. */
  constructor(dependencies: AgentConversationDependencies) {
    this.#dependencies = dependencies;
    this.#staleRunWatch = new StaleRunWatch(
      dependencies.agentRunStaleTimeoutMs,
      (subject) => this.#reportStale(subject),
    );
  }

  /** Read-only subscription to the surfaced conversation events. */
  get events(): EventSubscriber<AgentConversationEvents> {
    return this.#events;
  }

  /** Subscribes to agent and connection events of the current connector. */
  attach(): void {
    this.#detach();
    this.#startNewSession();
    const connector = this.#dependencies.currentConnector();
    const isFenced = this.#dependencies.captureFence('Agent event');
    const releaseAgentEvents = connector.onEvent((event) => {
      if (this.#attachment?.connector !== connector) return;
      if (isFenced(`${event.type} dropped`)) return;
      this.#conversationExists = true;
      this.#staleRunWatch.observe(event);
      this.#handleAgentEvent(event, connector, isFenced);
    });
    const releaseConnectionEvents = connector.subscribe(
      (event: ConnectorEvent) => {
        if (event.type !== 'disconnected') return;
        if (this.#attachment?.connector !== connector) return;
        this.#reportLoss('disconnected');
      },
    );
    this.#attachment = {
      connector,
      release: () => {
        releaseAgentEvents();
        releaseConnectionEvents();
      },
    };
  }

  /**
   * Moves to the current connector after a swap, reporting the loss of any
   * conversation held on the previous one.
   */
  replaceConnector(): void {
    const hadConversation = this.#hasConversation();
    this.#conversationExists = false;
    this.attach();
    if (hadConversation)
      this.#events.emit('conversation_lost', {
        type: 'conversation_lost',
        reason: 'connector_replaced',
      });
  }

  /**
   * Sends one utterance with a fresh Chart snapshot and resolves its input id
   * once the connector accepted it.
   */
  async sendMessage(
    text: string,
    options?: SendMessageOptions,
  ): Promise<MessageId> {
    const attachment = this.#attachment;
    if (attachment === null) throw new Error('Agent conversation is detached');
    const inputId = MessageId();
    const sessionGeneration = this.#sessionGeneration;
    const chart = this.#dependencies.buildChart();
    // The connector may deliver the reply before its send resolves, so the
    // input must be watched before the await or that reply finds no watch.
    this.#staleRunWatch.inputSent(inputId);
    this.#pendingUtterances++;
    this.#dependencies.diagnostics.emit('client.agent.input.sent', { inputId });
    try {
      await attachment.connector.sendInput({
        type: 'utterance',
        version: AGENT_WIRE_VERSION,
        inputId,
        text,
        chart,
        source: options?.source ?? 'text',
      });
    } catch (error) {
      if (sessionGeneration === this.#sessionGeneration)
        this.#pendingUtterances--;
      this.#staleRunWatch.stopInput(inputId);
      throw error;
    }
    if (sessionGeneration === this.#sessionGeneration) {
      this.#pendingUtterances--;
      this.#conversationExists = true;
    } else {
      this.#staleRunWatch.stopInput(inputId);
    }
    return inputId;
  }

  /**
   * Reports the conversation as lost because the Orchestrator disconnected on
   * purpose. A transport close for the same disconnect reports nothing more.
   */
  reportDisconnected(): void {
    this.#reportLoss('disconnected');
  }

  /** Detaches from the connector and disposes the emitter without reporting a loss. */
  dispose(): void {
    this.#detach();
    this.#conversationExists = false;
    this.#events.dispose();
  }

  #detach(): void {
    this.#staleRunWatch.clear();
    this.#attachment?.release();
    this.#attachment = null;
  }

  #startNewSession(): void {
    this.#sessionGeneration++;
    this.#pendingUtterances = 0;
  }

  #hasConversation(): boolean {
    return this.#conversationExists || this.#pendingUtterances > 0;
  }

  #reportStale(subject: StaleSubject): void {
    this.#startNewSession();
    this.#conversationExists = false;
    this.#events.emit('conversation_lost', {
      type: 'conversation_lost',
      reason: 'stale_run',
      ...subject,
    });
  }

  #reportLoss(reason: 'disconnected'): void {
    const hadConversation = this.#hasConversation();
    this.#conversationExists = false;
    this.#startNewSession();
    this.#staleRunWatch.clear();
    if (!hadConversation) return;
    this.#events.emit('conversation_lost', {
      type: 'conversation_lost',
      reason,
    });
  }

  #handleAgentEvent(
    event: AgentEvent,
    connector: EngineConnector,
    isFenced: FenceCheck,
  ): void {
    switch (event.type) {
      case 'placeholder':
        this.#events.emit('placeholder', event);
        return;
      case 'message':
        this.#events.emit('message', event);
        return;
      case 'finished':
        this.#events.emit('finished', event);
        return;
      case 'error':
        this.#events.emit('error', event);
        return;
      case 'ui_change':
        this.#applyUiChange(event, connector, isFenced);
        return;
      case 'accepted':
      case 'started':
      case 'tool_call':
      case 'tool_result':
        return;
    }
  }

  // Dispatch happens synchronously on arrival so the command queue applies
  // consecutive changes in the order the agent sent them.
  #applyUiChange(
    event: AgentUiChangeEvent,
    connector: EngineConnector,
    isFenced: FenceCheck,
  ): void {
    const receivedAt = this.#dependencies.now();
    const sessionGeneration = this.#sessionGeneration;
    let settlement: Promise<SettledAgentChange>;
    try {
      settlement = this.#dependencies.dispatchChange(event.response);
    } catch (error) {
      settlement = Promise.reject(toError(error));
    }
    void this.#acknowledgeUiChange(
      event,
      connector,
      isFenced,
      sessionGeneration,
      settlement,
      receivedAt,
    );
  }

  async #acknowledgeUiChange(
    event: AgentUiChangeEvent,
    connector: EngineConnector,
    isFenced: FenceCheck,
    sessionGeneration: number,
    settlement: Promise<SettledAgentChange>,
    receivedAt: number,
  ): Promise<void> {
    let settled: SettledAgentChange;
    try {
      settled = await settlement;
    } catch (error) {
      settled = {
        batch: { status: 'unknown', error: toError(error) },
        actions: undefined,
        chart: undefined,
      };
    }
    if (isFenced(`ui_applied for ${event.changeId} not sent`)) return;
    if (sessionGeneration !== this.#sessionGeneration) {
      this.#dependencies.logger.warn(
        `Agent conversation: ui_applied for ${event.changeId} not sent, its Agent Session ended`,
      );
      return;
    }

    const acknowledgement: AgentUiAppliedInput = {
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: event.changeId,
      chart: settled.chart ?? this.#dependencies.buildChart(),
      actionOutcomes: toActionOutcomes(event.response, settled),
    };
    this.#staleRunWatch.changeAcknowledged(event.changeId);
    this.#dependencies.diagnostics.emit('client.agent.ui.applied', {
      changeId: event.changeId,
      durationMs: Math.max(0, this.#dependencies.now() - receivedAt),
    });
    try {
      await connector.sendInput(acknowledgement);
    } catch (error) {
      this.#dependencies.logger.warn(
        `Agent conversation: ui_applied for ${event.changeId} was not sent`,
        error,
      );
    }
  }
}

function toActionOutcomes(
  response: MaelstromResponse,
  settled: SettledAgentChange,
): AgentActionOutcome[] {
  if (settled.batch.status === 'failed' && settled.actions === undefined) {
    const error = `not run: layout could not be applied: ${settled.batch.error.message}`;
    return response.executionPlan.map(() => ({ ok: false, error }));
  }
  return orderActionOutcomes(response.executionPlan, settled.actions ?? []);
}
