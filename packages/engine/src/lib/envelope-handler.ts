import type {
  ClientEnvelope,
  MessageId,
  ServerEnvelope,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  decodeClientEnvelope,
  EngineErrorMessage,
  HistoryResponseMessage,
  isErr,
  MaelstromResponseMessage,
  MessageId as brandMessageId,
  SessionId as brandSessionId,
} from '@maelstrom-co/protocol';

import { assertNever } from './assert-never.js';
import type { Engine } from './engine.js';

/**
 * Best-effort correlation recovery for a frame that failed to decode.
 *
 * A malformed frame has no typed envelope, but its raw JSON may still carry an
 * `id` / `sessionId` the client is awaiting. Extracting them lets the host
 * reject the pending promise instead of leaving the client to time out. Empty
 * strings are skipped because the branding constructors reject them (and an
 * empty id correlates to nothing anyway).
 */
const recoverCorrelation = (
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
  if (typeof record.id === 'string' && record.id.length > 0) {
    recovered.requestId = brandMessageId(record.id);
  }
  if (typeof record.sessionId === 'string' && record.sessionId.length > 0) {
    recovered.sessionId = brandSessionId(record.sessionId);
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
 *   `Ok` output to `null`.
 * - **`assistant_message`** → `engine.handle` fire-and-forget: `Ok` → `null`,
 *   `Err` → `engine.error`. Failures are surfaced (not swallowed) so a
 *   misconfiguration such as history-not-configured is visible to the client.
 * - **`client.history.get`** → `engine.getHistory`; `Ok` → `engine.history.response`,
 *   `Err` → `engine.error`.
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
              requestId: result.value.id,
              sessionId: envelope.sessionId,
              response: result.value.response,
            })
          : null;
      }

      case 'assistant_message': {
        const result = await engine.handle(envelope);
        if (isErr(result)) {
          return EngineErrorMessage({
            requestId: envelope.id,
            sessionId: envelope.sessionId,
            error: result.error.message,
            code: result.error._tag,
          });
        }
        return null;
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
