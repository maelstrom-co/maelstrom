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
 * - `'stale_run'`: an input or Agent Run saw no progress within the
 *   `agentRunStaleTimeoutMs` silence window.
 */
export type ConversationLostReason =
  | 'disconnected'
  | 'connector_replaced'
  | 'stale_run';

/**
 * Emitted when the Agent Session conversation is lost, discriminated by
 * `reason`.
 *
 * After `disconnected` or `connector_replaced` no further events arrive from
 * that session. After `stale_run` the run is presumed lost but late events
 * for it may still arrive and are delivered. The stale loss starts a new
 * session, so a `ui_applied` acknowledgement for a change still being applied
 * is dropped.
 */
export type ConversationLostEvent =
  | ConversationEndedEvent
  | StaleRunLostEvent
  | StaleInputLostEvent;

/**
 * The conversation ended with its transport or connector. No further events
 * arrive from that session.
 */
export type ConversationEndedEvent = {
  /** Discriminant, always `'conversation_lost'`. */
  type: 'conversation_lost';
  /** Why the conversation ended. */
  reason: 'disconnected' | 'connector_replaced';
  /** Never set, no run or input is named for this reason. */
  runId?: never;
  /** Never set, no run or input is named for this reason. */
  inputId?: never;
};

/**
 * An accepted Agent Run went silent. Late events for the run may still arrive
 * and are delivered.
 */
export type StaleRunLostEvent = {
  /** Discriminant, always `'conversation_lost'`. */
  type: 'conversation_lost';
  /** Always `'stale_run'`. */
  reason: 'stale_run';
  /** The Agent Run that stayed silent. */
  runId: RunId;
  /** Never set, the run was already accepted. */
  inputId?: never;
};

/**
 * An input stayed silent before the agent accepted it into a run. Late events
 * for the input may still arrive and are delivered.
 */
export type StaleInputLostEvent = {
  /** Discriminant, always `'conversation_lost'`. */
  type: 'conversation_lost';
  /** Always `'stale_run'`. */
  reason: 'stale_run';
  /** The input that never started a run. */
  inputId: MessageId;
  /** Never set, no run was accepted yet. */
  runId?: never;
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
  /**
   * Fires when the conversation is lost to a disconnect or connector
   * replacement, after which no further events arrive from that session. Also
   * fires with reason `stale_run` when an input or Agent Run goes silent. Late
   * events for that run may still arrive and a `ui_applied` for a change
   * still being applied is dropped.
   */
  conversation_lost: ConversationLostEvent;
};

/**
 * Options for `orchestrator.sendMessage`.
 */
export type SendMessageOptions = {
  /** How the user produced the message. Defaults to `'text'`. */
  source?: AgentInputSource;
};
