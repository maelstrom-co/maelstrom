import type {
  ChartRequestMessage,
  EnvelopeError,
  MaelstromResponse,
  MessageId as MessageIdType,
  SessionHistoryEntry,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  AssistantInjectionMessage,
  decodeServerEnvelope,
  encodeEnvelope,
  HistoryGetMessage,
  isErr,
  MessageId,
  toError,
} from '@maelstrom-co/protocol';
import type { Unsubscribe } from '../../types.js';
import { RequestCorrelator } from '../../utils/request-correlator.js';
import {
  type AssistantMessage,
  type ConnectorCapabilities,
  type ConnectorEvent,
  type EngineConnector,
  WireEngineError,
} from '../connector.types.js';
import {
  HEARTBEAT_PING_FRAME,
  isHeartbeatPongFrame,
} from './heartbeat-frame.js';

// A ping is "missed" if its interval elapses with no pong seen since. Two
// consecutive misses are required before the socket is closed: one miss is
// tolerated outright (a single delayed pong under load must not trip a
// reconnect), and confirming a second requires the interval to elapse twice
// more after the last good pong — so detection lands roughly two to three
// heartbeat intervals after the tunnel actually went quiet. That is still
// well inside RequestCorrelator's per-request timeout, so at most a couple of
// in-flight requests fail before the reconnect machinery takes over, rather
// than every request failing individually until a human notices.
const MAX_MISSED_HEARTBEATS = 2;

/**
 * Configuration options for WebSocket connector.
 */
export interface WebSocketConnectorOptions {
  /** WebSocket URL (ws:// or wss://) */
  url: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Connection establishment timeout in milliseconds (default: 10000) */
  connectTimeoutMs?: number;
  /**
   * Invoked once, synchronously, right after the socket opens and before
   * connect() resolves. Lets a consumer send a transport-level frame ahead
   * of the first protocol message (e.g. a host-specific auth handshake).
   * `send` bypasses envelope encoding — callers must produce valid JSON
   * text. Omitted entirely for consumers that don't need one; the connector
   * behaves exactly as it does today with no `onOpen` configured.
   */
  onOpen?: (send: (data: string) => void, sessionId: SessionId) => void;
  /**
   * If set, sends `{"type":"heartbeat.ping"}` on this interval while
   * connected. Needed for transports (e.g. Cloudflare Containers) that only
   * renew their idle timeout on socket traffic, not on an open-but-silent
   * connection. Omitted: no heartbeat is sent (local dev default). The
   * connector consumes the server's `heartbeat.pong` replies itself — they
   * never reach subscribers or the envelope decode path.
   *
   * Must be a finite positive number when provided — the constructor throws
   * otherwise. `0`, a negative value, and `NaN` would otherwise reach
   * `setInterval` as an effectively-immediate timer (flooding pings at the
   * server), and `Infinity` would silently never fire.
   */
  heartbeatIntervalMs?: number;
}

/**
 * WebSocket connector for real-time bidirectional communication.
 *
 * This connector is a thin wrapper around the WebSocket API. It:
 * - Opens/closes WebSocket connections
 * - Sends/receives messages with request/response correlation
 * - Reports transport events via `subscribe()`
 *
 * State management, retry logic, and circuit breaker patterns are handled
 * by ConnectionManager which consumes the transport events.
 *
 * @example
 * ```typescript
 * import { ConnectionManager, WebSocketConnector } from '@maelstrom-co/client';
 *
 * const connector = new WebSocketConnector({
 *   url: 'wss://api.example.com/ws',
 * });
 *
 * const manager = new ConnectionManager(store, connector);
 * await manager.connect(); // ConnectionManager handles state & retries
 * ```
 */
export class WebSocketConnector implements EngineConnector {
  readonly #url: string;
  readonly #timeout: number;
  readonly #connectTimeoutMs: number;
  readonly #onOpen:
    | ((send: (data: string) => void, sessionId: SessionId) => void)
    | undefined;
  readonly #heartbeatIntervalMs: number | undefined;

  readonly capabilities: ConnectorCapabilities = {
    voice: false,
    streaming: true,
    stateful: true,
  };

  #ws: WebSocket | null = null;
  // Identifies the socket a close event is allowed to act on. Unlike `#ws`
  // (which `disconnect()` nulls immediately, before the browser's close
  // event for that same socket has actually fired), this is only ever
  // reassigned by `connect()` -- so `disconnect()`'s own close event is
  // still recognized as live and reaches subscribers, while a *replaced*
  // socket's belated close (the StrictMode double-mount case below) is
  // still correctly ignored.
  #liveSocket: WebSocket | null = null;
  #sessionId: SessionId | null = null;
  #correlator = new RequestCorrelator();
  // Separate correlator so getHistory replies (typed as SessionHistoryEntry[]) cannot
  // collide with chart_request replies (typed as MaelstromResponse) on the
  // shared MessageId space, and so each correlator stays strongly typed.
  #historyCorrelator = new RequestCorrelator<readonly SessionHistoryEntry[]>();
  #handlers = new Set<(event: ConnectorEvent) => void>();
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  // Pings sent since the last pong was seen. Reset to 0 whenever a pong
  // arrives; checked (and incremented) on every heartbeat tick.
  #missedHeartbeats = 0;

  constructor(options: WebSocketConnectorOptions) {
    this.#url = options.url;
    this.#timeout = options.timeout ?? 30000;
    this.#connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.#onOpen = options.onOpen;
    if (
      options.heartbeatIntervalMs !== undefined &&
      !(
        Number.isFinite(options.heartbeatIntervalMs) &&
        options.heartbeatIntervalMs > 0
      )
    ) {
      // Guards a footgun in exported API, not a live incident: no current
      // caller passes anything but a hardcoded 30_000 or undefined. Left
      // unvalidated, 0/negative/NaN get handed straight to setInterval,
      // which coerces them to an effectively-immediate timer (flooding pings
      // at the server), and Infinity never fires at all.
      throw new Error(
        `WebSocketConnector: heartbeatIntervalMs must be a finite positive number or undefined, got ${options.heartbeatIntervalMs}`,
      );
    }
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs;
  }

  /**
   * Establishes WebSocket connection.
   * Throws on failure — ConnectionManager will handle retries.
   */
  async connect(sessionId: SessionId): Promise<void> {
    this.#sessionId = sessionId;
    return new Promise((resolve, reject) => {
      try {
        this.#ws = new WebSocket(this.#url);
        this.#liveSocket = this.#ws;

        const timeoutId = setTimeout(() => {
          cleanup();
          this.#ws?.close();
          this.#ws = null;
          reject(
            new Error(
              `WebSocket connection timed out after ${this.#connectTimeoutMs}ms`,
            ),
          );
        }, this.#connectTimeoutMs);

        const onOpen = () => {
          cleanup();
          try {
            this.#onOpen?.((data) => this.#ws?.send(data), sessionId);
          } catch (err) {
            // cleanup() already tore down the open/error/close listeners, so a
            // throw here has no other path back to the promise — without this
            // catch, connect() hangs in 'connecting' forever instead of
            // rejecting.
            this.#ws?.close();
            this.#ws = null;
            reject(toError(err));
            return;
          }
          this.#setupEventHandlers();
          this.#startHeartbeat();
          resolve();
        };

        const onError = () => {
          cleanup();
          reject(new Error('WebSocket connection error'));
        };

        const onClose = () => {
          cleanup();
          reject(new Error('WebSocket closed during connection'));
        };

        const cleanup = () => {
          clearTimeout(timeoutId);
          this.#ws?.removeEventListener('open', onOpen);
          this.#ws?.removeEventListener('error', onError);
          this.#ws?.removeEventListener('close', onClose);
        };

        this.#ws.addEventListener('open', onOpen);
        this.#ws.addEventListener('error', onError);
        this.#ws.addEventListener('close', onClose);
      } catch (err) {
        reject(toError(err));
      }
    });
  }

  /**
   * Closes the WebSocket connection and rejects all pending requests.
   */
  async disconnect(): Promise<void> {
    this.#stopHeartbeat();
    const disconnected = new Error('Disconnected');
    this.#correlator.rejectAll(disconnected);
    this.#historyCorrelator.rejectAll(disconnected);
    if (this.#ws) {
      // Explicit 1000, not a bare close(): closing without a status code
      // sends an empty close frame, and the resulting close event reports
      // 1005 ("no status received"). Now that this socket's own close
      // reaches subscribers, that would surface an intentional disconnect
      // as `clean: false` — the shape reserved for a connection that died
      // on its own, and the one auto-reconnect keys off.
      this.#ws.close(1000);
      this.#ws = null;
    }
  }

  /**
   * Subscribe to transport-level events (disconnected, error).
   */
  subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  /**
   * Sends a chart_request envelope and waits for the correlated response.
   */
  async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const promise = this.#correlator.create(message.id, this.#timeout);
    this.#ws.send(encodeEnvelope(message));
    return promise;
  }

  /**
   * Sends an assistant message to the server.
   * Fire-and-forget — the server does not send an ack for this message type.
   * Throws if the WebSocket is not connected.
   *
   * Translates the connector-facing {@link AssistantMessage} into the real
   * `assistant_message` envelope via {@link AssistantInjectionMessage} so the
   * frame goes through the same codec as every other send. The smart
   * constructor stamps a `Date.now()` epoch timestamp — the previous bespoke
   * frame used `performance.now()` (a monotonic clock offset from an arbitrary
   * origin), which is not a wall-clock time. Injection failures may arrive as
   * unsolicited `engine.error` frames; this method does not await or reject
   * on them.
   */
  async addAssistantMessage(message: AssistantMessage): Promise<void> {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    if (this.#sessionId === null) {
      throw new Error(
        'WebSocketConnector.addAssistantMessage called before connect() completed',
      );
    }

    this.#ws.send(
      encodeEnvelope(
        AssistantInjectionMessage({
          sessionId: this.#sessionId,
          content: message.message,
          id: message.id,
        }),
      ),
    );
  }

  /**
   * Sends a `client.history.get` request and waits for the correlated
   * `engine.history.response`. Correlation goes through `#historyCorrelator`
   * (typed for `SessionHistoryEntry[]`) so the response can't be misrouted
   * to `process()`'s `MaelstromResponse` correlator even if the freshly
   * generated request id happens to collide with an in-flight chart request.
   */
  async getHistory(
    sessionId: SessionId,
  ): Promise<readonly SessionHistoryEntry[]> {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    const requestId = MessageId();
    const promise = this.#historyCorrelator.create(requestId, this.#timeout);
    this.#ws.send(
      encodeEnvelope(HistoryGetMessage({ sessionId, id: requestId })),
    );
    return promise;
  }

  #startHeartbeat(): void {
    if (this.#heartbeatIntervalMs === undefined) return;
    this.#stopHeartbeat();
    this.#heartbeatTimer = setInterval(() => {
      if (this.#ws?.readyState !== WebSocket.OPEN) return;

      if (this.#missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
        // readyState still reports OPEN and no onclose has fired on its
        // own — exactly the failure this heartbeat exists to catch (a
        // Cloudflare edge drop, a vanished container: no TCP FIN reaches
        // the browser). Closing it ourselves is what makes the existing
        // onclose → `disconnected` → auto-reconnect path run at all;
        // without this, pings fire into the void forever and every intent
        // sits in RequestCorrelator until its own 30s timeout.
        this.#ws.close();
        return;
      }

      this.#missedHeartbeats++;
      this.#ws.send(HEARTBEAT_PING_FRAME);
    }, this.#heartbeatIntervalMs);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    this.#missedHeartbeats = 0;
  }

  #setupEventHandlers(): void {
    if (!this.#ws) return;
    // Captured by identity, not read back through `this.#ws`: if this
    // connector ever holds two sockets in sequence (React StrictMode's dev
    // double-mount shares a memoized connector between a disposed and
    // replacement Orchestrator), a delayed close event from the superseded
    // socket must not be able to act on the live one just because `this.#ws`
    // has moved on by the time the event fires.
    const socket = this.#ws;

    socket.onmessage = (event) => {
      this.#handleMessage(event);
    };

    socket.onclose = (event) => {
      // Ignore a close event from a socket a later connect() has already
      // replaced — without this, a superseded socket's delayed close would
      // clear the live socket's heartbeat, reject the live socket's pending
      // requests, and emit a spurious `disconnected` that drives an
      // unnecessary reconnect. Checked against `#liveSocket`, not `#ws`:
      // `disconnect()` nulls `#ws` synchronously, before this socket's own
      // close event fires, so comparing against `#ws` here would also
      // swallow every intentional disconnect's `disconnected` notification.
      if (socket !== this.#liveSocket) return;

      // An unexpected close leaves ConnectionManager's auto-reconnect
      // pending; stop here so the timer doesn't keep firing sends at a
      // socket that's already gone.
      this.#stopHeartbeat();
      const closed = new Error('WebSocket closed');
      this.#correlator.rejectAll(closed);
      this.#historyCorrelator.rejectAll(closed);
      const isClean = event.code === 1000;
      // RFC 6455: 1008 ("Policy Violation") is the server deliberately
      // rejecting this client — ws-server.ts uses it for a rejected
      // handshake and for an evicted session. Retrying is pointless by
      // definition, so this is flagged non-retryable regardless of `clean`
      // (a server-initiated close is never the 1000 "clean" case, but it is
      // also not a transient failure ConnectionManager should retry).
      const isPolicyViolation = event.code === 1008;
      this.#handlers.forEach((h) => {
        h({
          type: 'disconnected',
          clean: isClean,
          message: event.reason || `Connection closed with code ${event.code}`,
          ...(isPolicyViolation ? { retryable: false } : {}),
        });
      });
    };

    socket.onerror = () => {
      this.#handlers.forEach((h) => {
        h({ type: 'error', error: new Error('WebSocket error occurred') });
      });
    };
  }

  #handleMessage(event: MessageEvent): void {
    // heartbeat.pong is transport-level, not part of the protocol envelope
    // union by design — decodeServerEnvelope would reject it as undecodable.
    // Only intercept it when the heartbeat option is active, so a stray pong
    // with heartbeat disabled still falls through to the normal (warning) path.
    if (
      this.#heartbeatIntervalMs !== undefined &&
      this.#isHeartbeatPong(event.data)
    ) {
      this.#missedHeartbeats = 0;
      return;
    }

    // The codec owns parse + schema validation: a malformed JSON string or a
    // frame that violates the ServerEnvelope contract comes back as an Err
    // instead of throwing, so there is no outer try/catch here.
    const decoded = decodeServerEnvelope(event.data);
    if (isErr(decoded)) {
      this.#handleDecodeFailure(event.data, decoded.error);
      return;
    }

    const envelope = decoded.value;
    switch (envelope.type) {
      case 'engine.maelstrom.response': {
        // requestId is already a branded MessageId from the codec, and the
        // response is schema-validated — the first point in the client where
        // a MaelstromResponse is guaranteed well-formed before it resolves.
        const resolved = this.#correlator.resolve(
          envelope.requestId,
          envelope.response,
        );
        if (!resolved) {
          console.warn(
            `[WebSocketConnector] engine.maelstrom.response with no pending request: requestId=${envelope.requestId}`,
          );
        }
        return;
      }

      case 'engine.history.response': {
        const resolved = this.#historyCorrelator.resolve(
          envelope.requestId,
          envelope.entries,
        );
        if (!resolved) {
          console.warn(
            `[WebSocketConnector] engine.history.response with no pending request: requestId=${envelope.requestId}`,
          );
        }
        return;
      }

      case 'engine.error': {
        if (envelope.requestId === undefined) {
          // A stream-level fault the host could not correlate to a request
          // (e.g. it failed before recovering an id). Nothing to reject.
          console.warn(
            `[WebSocketConnector] engine.error with no requestId: error=${envelope.error}`,
          );
          return;
        }
        // engine.error is shared across response types — reject both
        // correlators unconditionally so that if a request id happens to be
        // pending in both (the typed-isolation rationale of #historyCorrelator
        // assumes such collisions are possible), each caller observes the
        // error rather than silently waiting until its own timeout fires.
        // reject() is a no-op for unknown ids, so the redundant call is free.
        const error = new WireEngineError(envelope.error, envelope.code);
        const inChart = this.#correlator.reject(envelope.requestId, error);
        const inHistory = this.#historyCorrelator.reject(
          envelope.requestId,
          error,
        );
        if (!inChart && !inHistory) {
          // Most likely cause: post-timeout server failure delivery. The
          // chart/history paths warn on the same condition; symmetry here
          // keeps a real diagnostic from being silently swallowed.
          console.warn(
            `[WebSocketConnector] engine.error with no pending request: requestId=${envelope.requestId} error=${error.message}`,
          );
        }
        return;
      }
    }
  }

  /**
   * A frame that failed to decode used to be trusted silently. Now it rejects
   * the pending request it correlates to: a malformed `engine.maelstrom.response`
   * fails the pending `process()` promise with the {@link EnvelopeError} rather
   * than stranding it until timeout. The id is recovered directly from the raw
   * frame because the typed envelope — the normal source of `requestId` — is
   * exactly what could not be produced.
   */
  #handleDecodeFailure(raw: unknown, error: EnvelopeError): void {
    const requestId = this.#recoverRequestId(raw);
    if (requestId === undefined) {
      console.warn(`[WebSocketConnector] undecodable frame: ${error.message}`);
      return;
    }
    const inChart = this.#correlator.reject(requestId, error);
    const inHistory = this.#historyCorrelator.reject(requestId, error);
    if (!inChart && !inHistory) {
      console.warn(
        `[WebSocketConnector] undecodable frame with no pending request: requestId=${requestId}: ${error.message}`,
      );
    }
  }

  // Minimal, best-effort check — text frames only, mirroring #recoverRequestId's
  // style. A non-string payload (Blob/ArrayBuffer) or non-JSON text simply
  // isn't a heartbeat frame and falls through to the normal decode path.
  #isHeartbeatPong(raw: unknown): boolean {
    if (typeof raw !== 'string') return false;
    try {
      return isHeartbeatPongFrame(JSON.parse(raw));
    } catch {
      return false;
    }
  }

  // Best-effort correlation recovery for a frame the codec rejected. Server
  // envelopes carry `requestId` (not `id`); a whitespace-only value is skipped
  // because the MessageId brand rejects it and it correlates to nothing.
  #recoverRequestId(raw: unknown): MessageIdType | undefined {
    let value: unknown = raw;
    if (typeof raw === 'string') {
      try {
        value = JSON.parse(raw);
      } catch {
        return undefined;
      }
    } else if (raw instanceof Uint8Array) {
      try {
        value = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return undefined;
      }
    }

    if (typeof value !== 'object' || value === null) return undefined;
    const requestId = (value as Record<string, unknown>).requestId;
    if (typeof requestId === 'string' && requestId.trim().length > 0) {
      return MessageId(requestId);
    }
    return undefined;
  }
}
