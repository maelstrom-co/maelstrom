import type {
  AgentErrorEvent,
  AgentFinishedEvent,
  AgentInputSource,
  AgentMessageEvent,
  AgentPlaceholderEvent,
} from '@maelstrom-co/protocol';

/**
 * Why the Agent Session conversation can no longer continue.
 *
 * - `'disconnected'`: the transport closed.
 * - `'connector_replaced'`: the Orchestrator switched to a different connector.
 */
export type ConversationLostReason = 'disconnected' | 'connector_replaced';

/**
 * Emitted when the Agent Session conversation is lost and any in-flight
 * Agent Run will not deliver further events.
 */
export type ConversationLostEvent = {
  /** Discriminant, always `'conversation_lost'`. */
  type: 'conversation_lost';
  /** Why the conversation was lost. */
  reason: ConversationLostReason;
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
  /** Fires when the agent reports an error for the current input. */
  error: AgentErrorEvent;
  /** Fires when the conversation is lost to a disconnect or connector replacement. */
  conversation_lost: ConversationLostEvent;
};

/**
 * Options for `orchestrator.sendUtterance`.
 */
export type SendUtteranceOptions = {
  /** How the user produced the utterance. Defaults to `'text'`. */
  source?: AgentInputSource;
};
