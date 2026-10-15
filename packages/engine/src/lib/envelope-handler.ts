import type {
  ClientEnvelope,
  MessageId,
  ServerEnvelope,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  AssistantInjectionMessage,
  AssistantMessageResultMessage,
  MessageId as brandMessageId,
  SessionId as brandSessionId,
  decodeClientEnvelope,
  EngineErrorMessage,
  HistoryResponseMessage,
  isErr,
  MaelstromResponseMessage,
} from '@maelstrom-co/protocol';

import { assertNever } from './assert-never.js';
import type { Engine } from './engine.js';

/**
 * Best-effort correlation recovery for a frame that failed to decode.
 *
 * A malformed frame has no typed envelope, but its raw JSON may still carry an
 * `id` / `sessionId` the client is awaiting. Extracting them lets the host
 * reject the pending promise instead of leaving the client to time out.
 * Blank (empty or whitespace-only) strings are skipped since they correlate
 * to nothing, and branding is defensively guarded so recovery can never
 * throw. Returns `{}` when nothing could be recovered.
 */
export const recoverCorrelation = (
  raw: unknown,
): { requestId?: MessageId; sessionId?: SessionId } => {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  } else if (raw instanceof Uint8Array) {
    try {
      value = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return {};
    }
  }

  if (typeof value !== 'object' || value === null) return {};
  const record = value as Record<string, unknown>;

  const recovered: { requestId?: MessageId; sessionId?: SessionId } = {};
  if (typeof record.id === 'string' && record.id.trim().length > 0) {
    try {
      recovered.requestId = brandMessageId(record.id);
    } catch {
      // unbrandable — leave uncorrelated rather than throw
    }
  }
  if (
    typeof record.sessionId === 'string' &&
    record.sessionId.trim().length > 0
  ) {
    try {
      recovered.sessionId = brandSessionId(record.sessionId);
    } catch {
      // unbrandable — leave uncorrelated rather than throw
    }
  }
  return recovered;
};

/**
 * The single dispatch entry point every WebSocket engine host shares: decode a
 * raw client frame, route it to the {@link Engine}, and map the outcome to the
 * {@link ServerEnvelope} the host should send back (or `null` when the frame
 * warrants no reply).
 *
 * Centralizing this keeps every host from re-deriving the decode → dispatch →
 * error-mapping logic (and drifting on error correlation). The mapping, by
 * frame type:
 *
 * - **decode failure** → an `engine.error` carrying the {@link EnvelopeError}
 *   message and its `kind` as `code`. Correlation ids are recovered from the
 *   raw frame when present so the client's pending request is rejected rather
 *   than left to time out.
 * - **`chart_request`** → `engine.handle`; an engine `Err` maps to
 *   `engine.error` (the {@link import('./errors.js').EngineError} `_tag` as
 *   `code`), an `Ok` `chart_response` to `engine.maelstrom.response`, any other
 *   `Ok` output to `engine.error` with `code: 'UnexpectedOutput'` (a
 *   contract violation, not a case that should strand the client silently).
 * - **`assistant_message`** → `engine.handle`, then always `null`. This legacy
 *   fire-and-forget arm emits no result or error frame, including when Engine
 *   returns or throws a history failure.
 * - **`client.assistant_message.acknowledged`** → the same assistant injection
 *   semantics through `engine.handle`; an `Ok` `assistant_message_result` maps
 *   to a correlated `engine.assistant_message.result`. Unexpected output,
 *   Engine errors, and thrown failures map to a correlated `engine.error`.
 * - **`client.history.get`** → `engine.getHistory`; `Ok` → `engine.history.response`,
 *   `Err` → `engine.error`.
 * - **`client.agent.input`** → a correlated `engine.error` with
 *   `code: 'UnsupportedInput'`. The Engine does not handle agent inputs yet.
 *
 * Never rejects. A thrown exception (an engine contract violation) is caught
 * and mapped to an `engine.error` correlated to the in-scope frame, with no
 * `code`.
 *
 * @example
 * ```ts
 * // WebSocket host message loop
 * ws.on('message', async (raw) => {
 *   const reply = await handleEnvelope(engine, raw);
 *   if (reply) ws.send(encodeEnvelope(reply));
 * });
 * ```
 */
export async function handleEnvelope(
  engine: Engine,
  raw: unknown,
): Promise<ServerEnvelope | null> {
  const decoded = decodeClientEnvelope(raw);
  if (isErr(decoded)) {
    return EngineErrorMessage({
      error: decoded.error.message,
      code: decoded.error.kind,
      ...recoverCorrelation(raw),
    });
  }

  const envelope: ClientEnvelope = decoded.value;

  try {
    switch (envelope.type) {
      case 'client.diagnostics.subscribe':
        return null;
      case 'chart_request': {
        const result = await engine.handle(envelope);
        if (isErr(result)) {
          return EngineErrorMessage({
            requestId: envelope.id,
            sessionId: envelope.sessionId,
            error: result.error.message,
            code: result.error._tag,
          });
        }
        return result.value.type === 'chart_response'
          ? MaelstromResponseMessage({
              requestId: envelope.id,
              sessionId: envelope.sessionId,
              response: result.value.response,
            })
          : EngineErrorMessage({
              requestId: envelope.id,
              sessionId: envelope.sessionId,
              error: `engine returned unexpected output type "${result.value.type}" for chart_request`,
              code: 'UnexpectedOutput',
            });
      }

      case 'assistant_message': {
        try {
          await engine.handle(envelope);
        } catch {
          // Legacy callers are fire-and-forget even when history insertion fails.
        }
        return null;
      }

      case 'client.assistant_message.acknowledged': {
        const result = await engine.handle(
          AssistantInjectionMessage({
            sessionId: envelope.sessionId,
            id: envelope.id,
            timestamp: envelope.timestamp,
            content: envelope.content,
          }),
        );
        if (isErr(result)) {
          return EngineErrorMessage({
            requestId: envelope.id,
            sessionId: envelope.sessionId,
            error: result.error.message,
            code: result.error._tag,
          });
        }
        return result.value.type === 'assistant_message_result'
          ? AssistantMessageResultMessage({
              requestId: envelope.id,
              sessionId: envelope.sessionId,
              outcome: result.value.outcome,
            })
          : EngineErrorMessage({
              requestId: envelope.id,
              sessionId: envelope.sessionId,
              error: `engine returned unexpected output type "${result.value.type}" for client.assistant_message.acknowledged`,
              code: 'UnexpectedOutput',
            });
      }

      case 'client.history.get': {
        const result = await engine.getHistory(envelope.sessionId);
        if (isErr(result)) {
          return EngineErrorMessage({
            requestId: envelope.id,
            sessionId: envelope.sessionId,
            error: result.error.message,
            code: result.error._tag,
          });
        }
        return HistoryResponseMessage({
          requestId: envelope.id,
          entries: result.value,
        });
      }

      case 'client.agent.input':
        return EngineErrorMessage({
          requestId: envelope.id,
          sessionId: envelope.sessionId,
          error: 'agent inputs are not supported yet',
          code: 'UnsupportedInput',
        });

      default:
        return assertNever(envelope, 'handleEnvelope');
    }
  } catch (error) {
    return EngineErrorMessage({
      requestId: envelope.id,
      sessionId: envelope.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
