import {
  AGENT_WIRE_VERSION,
  type AgentActionOutcome,
  type AgentEvent,
  type AgentUiAppliedInput,
  type AgentUiChangeEvent,
  type ChartRequest,
  type MaelstromResponse,
  type MessageId,
  toError,
} from '@maelstrom-co/protocol';

import type { ActionRecord } from '../command-processor/action-runner.types.js';
import type { CommandBatchResult } from '../command-processor/command-batch-result.js';
import {
  AgentWireUnsupportedError,
  type ConnectorEvent,
  type EngineConnector,
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
  /**
   * Receives observations of agent inputs as they are sent and of UI changes
   * as they are acknowledged. They carry identifiers and timing only, never
   * content.
   */
  readonly diagnostics: Pick<DiagnosticChannel, 'emit'>;
  /** Reads a monotonic clock in milliseconds to time UI change acknowledgements. */
  readonly now: () => number;
};

/** How sending one utterance ended. */
export type AgentSendOutcome =
  | {
      /** The connector accepted the frame. */
      readonly status: 'sent';
    }
  | {
      /** The frame never left the client, so it had no side effect. */
      readonly status: 'not_sent';
      /** Why the frame was not sent. */
      readonly error: Error;
    }
  | {
      /** The transport refused the frame. Whether the agent saw it is unknown. */
      readonly status: 'failed';
      /** The transport's error. */
      readonly error: Error;
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
  #endedSessions = 0;

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
    this.#endedSessions++;
    this.attach();
    if (hadConversation)
      this.#events.emit('conversation_lost', {
        type: 'conversation_lost',
        reason: 'connector_replaced',
      });
  }

  /**
   * Sends one utterance under `inputId` with a fresh Chart snapshot. Settles
   * with `sent` once the connector accepted the frame, `not_sent` when the
   * frame never left the client, or `failed` when the transport refused it.
   * Calls `onSending` synchronously right before the frame is handed to the
   * connector. When `onSending` ends the conversation, the frame is not sent
   * and the outcome is `not_sent`. Never rejects.
   */
  async sendMessage(
    inputId: MessageId,
    text: string,
    options: SendMessageOptions | undefined,
    onSending: () => void,
  ): Promise<AgentSendOutcome> {
    const attachment = this.#attachment;
    if (attachment === null)
      return notSent(new Error('Agent conversation is detached'));
    const sessionGeneration = this.#sessionGeneration;
    let chart: ChartRequest;
    try {
      chart = this.#dependencies.buildChart();
    } catch (error) {
      return notSent(toError(error));
    }
    // The connector may deliver the reply before its send resolves, so the
    // input must be watched before the await or that reply finds no watch.
    this.#staleRunWatch.inputSent(inputId);
    this.#pendingUtterances++;
    this.#dependencies.diagnostics.emit('client.agent.input.sent', { inputId });
    // Diagnostic observers and `onSending` run caller code synchronously,
    // which may swap the connector, disconnect or dispose and would leave
    // this send on a stale session.
    const endedBeforeSend = (): AgentSendOutcome | null => {
      if (
        this.#attachment === attachment &&
        sessionGeneration === this.#sessionGeneration
      )
        return null;
      if (sessionGeneration === this.#sessionGeneration)
        this.#pendingUtterances--;
      this.#staleRunWatch.stopInput(inputId);
      return notSent(
        new Error('Agent conversation ended before the utterance was sent'),
      );
    };
    const endedByObserver = endedBeforeSend();
    if (endedByObserver !== null) return endedByObserver;
    onSending();
    const endedByCaller = endedBeforeSend();
    if (endedByCaller !== null) return endedByCaller;
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
      return error instanceof AgentWireUnsupportedError
        ? notSent(error)
        : { status: 'failed', error: toError(error) };
    }
    if (sessionGeneration === this.#sessionGeneration) {
      this.#pendingUtterances--;
      this.#conversationExists = true;
    } else {
      this.#staleRunWatch.stopInput(inputId);
    }
    return { status: 'sent' };
  }

  /**
   * Reports the conversation as lost because the Orchestrator disconnected on
   * purpose. A transport close for the same disconnect reports nothing more.
   */
  reportDisconnected(): void {
    this.#reportLoss('disconnected');
  }

  /**
   * Reports the conversation as lost with reason `disconnected`, as
   * {@link reportDisconnected} does, then detaches from the connector and
   * disposes the emitter.
   */
  dispose(): void {
    this.#reportLoss('disconnected');
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
    this.#endedSessions++;
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
        this.#events.emit('accepted', {
          type: 'accepted',
          inputId: event.inputId,
          runId: event.runId,
          disposition: event.disposition,
          ack: event.ack,
        });
        return;
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
    const change: AppliedUiChange = {
      event,
      connector,
      isFenced,
      sessionGeneration: this.#sessionGeneration,
      endedSessions: this.#endedSessions,
      receivedAt: this.#dependencies.now(),
    };
    let settlement: Promise<SettledAgentChange>;
    try {
      settlement = this.#dependencies.dispatchChange(event.response);
    } catch (error) {
      settlement = Promise.reject(toError(error));
    }
    void this.#settleUiChange(change, settlement);
  }

  async #settleUiChange(
    change: AppliedUiChange,
    settlement: Promise<SettledAgentChange>,
  ): Promise<void> {
    const { event } = change;
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
    const actionOutcomes = toActionOutcomes(event.response, settled);
    // The acknowledgement step runs synchronously up to handing its frame to
    // the connector, so emitting once it started keeps the ui_applied ahead of
    // the event and out of listeners' reach, while a slow or never settling
    // send cannot delay the event. The event fires even when the
    // acknowledgement was dropped or its send failed.
    const acknowledgement = this.#acknowledgeUiChange(
      change,
      settled,
      actionOutcomes,
    );
    if (change.endedSessions === this.#endedSessions)
      this.#events.emit('ui_change', {
        type: 'ui_change',
        runId: event.runId,
        changeId: event.changeId,
        actionOutcomes: actionOutcomes.map((outcome) => ({ ...outcome })),
      });
    try {
      await acknowledgement;
    } catch (error) {
      this.#dependencies.logger.warn(
        `Agent conversation: ui_applied for ${event.changeId} was not sent`,
        error,
      );
    }
  }

  async #acknowledgeUiChange(
    change: AppliedUiChange,
    settled: SettledAgentChange,
    actionOutcomes: AgentActionOutcome[],
  ): Promise<void> {
    const { event, connector } = change;
    if (this.#isAcknowledgementStale(change)) return;

    const acknowledgement: AgentUiAppliedInput = {
      type: 'ui_applied',
      version: AGENT_WIRE_VERSION,
      changeId: event.changeId,
      chart: settled.chart ?? this.#dependencies.buildChart(),
      actionOutcomes,
    };
    this.#staleRunWatch.changeAcknowledged(event.changeId);
    this.#dependencies.diagnostics.emit('client.agent.ui.applied', {
      changeId: event.changeId,
      durationMs: Math.max(0, this.#dependencies.now() - change.receivedAt),
    });
    // Diagnostic observers run synchronously and may swap the connector or
    // end the Agent Session before the acknowledgement goes out.
    if (this.#isAcknowledgementStale(change)) return;
    try {
      await connector.sendInput(acknowledgement);
    } catch (error) {
      this.#dependencies.logger.warn(
        `Agent conversation: ui_applied for ${event.changeId} was not sent`,
        error,
      );
    }
  }

  #isAcknowledgementStale({
    event,
    isFenced,
    sessionGeneration,
  }: AppliedUiChange): boolean {
    if (isFenced(`ui_applied for ${event.changeId} not sent`)) return true;
    if (sessionGeneration === this.#sessionGeneration) return false;
    this.#dependencies.logger.warn(
      `Agent conversation: ui_applied for ${event.changeId} not sent, its Agent Session ended`,
    );
    return true;
  }
}

type AppliedUiChange = {
  readonly event: AgentUiChangeEvent;
  readonly connector: EngineConnector;
  readonly isFenced: FenceCheck;
  readonly sessionGeneration: number;
  readonly endedSessions: number;
  readonly receivedAt: number;
};

function notSent(error: Error): AgentSendOutcome {
  return { status: 'not_sent', error };
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
