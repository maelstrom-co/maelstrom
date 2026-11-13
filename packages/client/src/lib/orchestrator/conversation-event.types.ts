import type {
  AgentErrorEvent,
  AgentFinishedEvent,
  AgentInputSource,
  AgentMessageEvent,
  AgentPlaceholderEvent,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';

/**
 * Why the Agent Session conversation can no longer continue.
 *
 * - `'disconnected'`: the transport closed, or the Orchestrator disconnected.
 * - `'connector_replaced'`: the Orchestrator switched to a different connector.
 * - `'stale_run'`: an Agent Run saw no `finished` event within the
 *   `agentRunStaleTimeoutMs` silence window.
 */
export type ConversationLostReason =
  | 'disconnected'
  | 'connector_replaced'
  | 'stale_run';

/**
 * Emitted when the Agent Session conversation is lost and any in-flight
 * Agent Run will not deliver further events.
 */
export type ConversationLostEvent = {
  /** Discriminant, always `'conversation_lost'`. */
  type: 'conversation_lost';
  /** Why the conversation was lost. */
  reason: ConversationLostReason;
  /** The stale Agent Run, set when the run was known at the time of loss. */
  runId?: RunId;
  /** The input that never started a run, set when no run was known yet. */
  inputId?: MessageId;
};

/**
 * Events the Orchestrator emits for the Agent Session conversation.
 * Subscribe through `orchestrator.agent.on(...)`.
 */
export type AgentConversationEvents = {
  /** Fires when the agent sends a placeholder to show while it works. */
  placeholder: AgentPlaceholderEvent;
  /** Fires when the agent sends a conversational message for the user. */
  message: AgentMessageEvent;
  /** Fires when an Agent Run ends, whatever the reason. */
  finished: AgentFinishedEvent;
  /**
   * Fires when the agent reports a failure outside any Agent Run, such as an
   * admission rejection. It carries the `inputId` when the failure relates to
   * an input.
   */
  error: AgentErrorEvent;
  /** Fires when the conversation is lost to a disconnect or connector replacement. */
  conversation_lost: ConversationLostEvent;
};

/**
 * Options for `orchestrator.sendMessage`.
 */
export type SendMessageOptions = {
  /** How the user produced the message. Defaults to `'text'`. */
  source?: AgentInputSource;
};
