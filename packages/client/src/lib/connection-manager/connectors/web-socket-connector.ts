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

  readonly capabilities: ConnectorCapabilities = {
    voice: false,
    streaming: true,
    stateful: true,
  };

  #ws: WebSocket | null = null;
  #sessionId: SessionId | null = null;
  #correlator = new RequestCorrelator();
  // Separate correlator so getHistory replies (typed as SessionHistoryEntry[]) cannot
  // collide with chart_request replies (typed as MaelstromResponse) on the
  // shared MessageId space, and so each correlator stays strongly typed.
  #historyCorrelator = new RequestCorrelator<readonly SessionHistoryEntry[]>();
  #handlers = new Set<(event: ConnectorEvent) => void>();

  constructor(options: WebSocketConnectorOptions) {
    this.#url = options.url;
    this.#timeout = options.timeout ?? 30000;
    this.#connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
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
          this.#setupEventHandlers();
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
    const disconnected = new Error('Disconnected');
    this.#correlator.rejectAll(disconnected);
    this.#historyCorrelator.rejectAll(disconnected);
    if (this.#ws) {
      this.#ws.close();
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

  #setupEventHandlers(): void {
    if (!this.#ws) return;

    this.#ws.onmessage = (event) => {
      this.#handleMessage(event);
    };

    this.#ws.onclose = (event) => {
      const closed = new Error('WebSocket closed');
      this.#correlator.rejectAll(closed);
      this.#historyCorrelator.rejectAll(closed);
      const isClean = event.code === 1000;
      this.#handlers.forEach((h) => {
        h({
          type: 'disconnected',
          clean: isClean,
          message: event.reason || `Connection closed with code ${event.code}`,
        });
      });
    };

    this.#ws.onerror = () => {
      this.#handlers.forEach((h) => {
        h({ type: 'error', error: new Error('WebSocket error occurred') });
      });
    };
  }

  #handleMessage(event: MessageEvent): void {
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
