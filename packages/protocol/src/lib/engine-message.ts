import { MessageId } from './message.js';
import type { ChartRequest } from './request.js';
import type { SessionId } from './session.js';

const resolveTimestamp = (value: number | undefined, source: string): number => {
  if (value === undefined) {
    return Date.now();
  }
  // `HistoryManager.getHistory` / `getLLMContext` sort by this field — a
  // non-finite value (NaN, ±Infinity) would make the sort non-deterministic
  // and silently corrupt session ordering. Reject at construction so the
  // invariant is established before the envelope enters the engine.
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${source}: timestamp must be a finite number, got ${String(value)}`,
    );
  }
  return value;
};

/**
 * Common metadata carried on every message sent to the engine.
 *
 * Identifies which conversation the message belongs to (`sessionId`) and gives
 * every message a stable identifier (`id`) used for response correlation,
 * dedup (assistant_message variants), and audit.
 */
export interface EngineMessageBase {
  readonly sessionId: SessionId;
  readonly id: MessageId;
  /** Client-set milliseconds since epoch. Used for audit/trace, not logic. */
  readonly timestamp: number;
}

/**
 * A chart_request envelope: the LLM is asked to produce a layout + execution
 * plan given the current chart state and accumulated update reasons.
 */
export interface ChartRequestMessage extends EngineMessageBase {
  readonly type: 'chart_request';
  readonly request: ChartRequest;
}

/**
 * An assistant_message envelope: developer-injected content recorded into
 * session history so subsequent LLM turns have it in context. Does not call
 * the LLM itself.
 */
export interface AssistantInjectionMessage extends EngineMessageBase {
  readonly type: 'assistant_message';
  readonly content: string;
}

/**
 * Tagged union of every input the engine knows how to handle. Adding a new
 * message kind (audio intent, system notification, etc.) means adding a
 * variant here and a new branch in the engine's router.
 */
export type EngineMessage = ChartRequestMessage | AssistantInjectionMessage;

/**
 * Smart constructor for {@link ChartRequestMessage}. Fills in `id` and
 * `timestamp` with sensible defaults when omitted so callers only have to
 * supply the session + payload in the common case.
 */
export const ChartRequestMessage = (args: {
  sessionId: SessionId;
  request: ChartRequest;
  id?: MessageId;
  timestamp?: number;
}): ChartRequestMessage => ({
  type: 'chart_request',
  sessionId: args.sessionId,
  id: args.id ?? MessageId(),
  timestamp: resolveTimestamp(args.timestamp, 'ChartRequestMessage'),
  request: args.request,
});

/**
 * Smart constructor for {@link AssistantInjectionMessage}. Fills in `id` and
 * `timestamp` with sensible defaults when omitted.
 */
export const AssistantInjectionMessage = (args: {
  sessionId: SessionId;
  content: string;
  id?: MessageId;
  timestamp?: number;
}): AssistantInjectionMessage => ({
  type: 'assistant_message',
  sessionId: args.sessionId,
  id: args.id ?? MessageId(),
  timestamp: resolveTimestamp(args.timestamp, 'AssistantInjectionMessage'),
  content: args.content,
});
