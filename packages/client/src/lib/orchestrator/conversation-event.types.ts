import type {
  AgentActionOutcome,
  AgentDisposition,
  AgentErrorEvent,
  AgentFinishedEvent,
  AgentInputSource,
  AgentMessageEvent,
  AgentPlaceholderEvent,
  AgentUiAppliedInput,
  ChangeId,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';
import type { Store } from '@tanstack/store';

import type { EventSubscriber } from '../utils/typed-emitter.js';
import type { AgentRunsSnapshot, SettledAgentRun } from './agent-run-state.js';

/**
 * Emitted when the agent accepts an input. It is the only link from the
 * `inputId` that `sendMessage` returned to the Agent Run that handles it.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentInputAcceptedEvent = {
  /** Discriminant, always `'accepted'`. */
  type: 'accepted';
  /** The input the agent accepted, as returned by `sendMessage`. */
  inputId: MessageId;
  /**
   * The Agent Run that handles the input. It is `null` exactly when the
   * disposition is `noise`, since no run starts then.
   */
  runId: RunId | null;
  /** How the agent decided to handle the input. */
  disposition: AgentDisposition;
  /** A short acknowledgement of the input the client may show or speak. */
  ack: string;
};

/**
 * Emitted once per agent UI change after the Orchestrator finished applying
 * it. It is a notification only, listeners can alter neither the apply nor
 * the acknowledgement. The change is acknowledged to the agent unless its
 * Agent Session ended or the send failed, and its outcomes may report failed
 * Actions. A change still applying when the conversation is lost to
 * `disconnected` or `connector_replaced` is applied but reports no event.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentUiChangeAppliedEvent = {
  /** Discriminant, always `'ui_change'`. */
  type: 'ui_change';
  /** The Agent Run that caused the change, or `null` outside any run. */
  runId: RunId | null;
  /** The change the agent sent, as echoed in its acknowledgement. */
  changeId: ChangeId;
  /**
   * Whole-batch application status, including Layout-only changes. Always
   * set by the Orchestrator; optional for events constructed by older clients.
   */
  status?: AgentUiAppliedInput['status'];
  /**
   * One outcome per planned Action in order. A refused Layout marks every
   * Action as not run. Use `status` to determine whether the batch succeeded.
   */
  actionOutcomes: readonly Readonly<AgentActionOutcome>[];
};

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
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
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
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
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
 * Subscribe through `orchestrator.agent.events.on(...)`.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentConversationEvents = {
  /** Fires when the agent accepts an input, naming the run that handles it. */
  accepted: AgentInputAcceptedEvent;
  /** Fires once for each UI change after the Orchestrator applied it. */
  ui_change: AgentUiChangeAppliedEvent;
  /** Fires when the agent sends a placeholder to show while it works. */
  placeholder: AgentPlaceholderEvent;
  /** Fires when the agent sends a conversational message for the user. */
  message: AgentMessageEvent;
  /** Fires when an Agent Run ends, whatever the reason. */
  finished: AgentFinishedEvent;
  /**
   * Fires when the agent reports a failure that is not an Agent Run's own
   * ending, such as an admission rejection. It carries the `inputId` when the
   * failure relates to an input. It also reports a failed loop-driven UI change
   * of an Agent Run, named by `runId` and `changeId`, which can arrive mid-run
   * or after that run's `finished`.
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
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type SendMessageOptions = {
  /** How the user produced the message. Defaults to `'text'`. */
  source?: AgentInputSource;
};

/**
 * The Orchestrator's view of its Agent Session conversation.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type OrchestratorAgent = {
  /** Raw agent events, subscribed through `events.on(type, handler)`. */
  readonly events: EventSubscriber<AgentConversationEvents>;
  /**
   * Agent Run state of every input sent through `sendMessage`, capped at the
   * 20 latest inputs.
   */
  readonly store: Store<AgentRunsSnapshot>;
};

/**
 * What `orchestrator.sendMessage` returns.
 *
 * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
 */
export type AgentMessageSubmission = {
  /** The input id the agent's events for this message carry. */
  readonly inputId: MessageId;
  /**
   * The input's Agent Run state at the moment it settled. Settles exactly
   * once and never rejects. Later events may still change the run in the
   * store, for example after a `stale_run` loss.
   */
  readonly result: Promise<SettledAgentRun>;
};
