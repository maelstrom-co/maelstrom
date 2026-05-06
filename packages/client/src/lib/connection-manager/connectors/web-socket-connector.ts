import type {
  ChartRequestMessage,
  MaelstromResponse,
  SessionHistoryEntry,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  MessageId,
  SessionHistoryEntryArraySchema,
  toError,
} from '@maelstrom-co/protocol';
import type { Unsubscribe } from '../../types.js';
import { RequestCorrelator } from '../../utils/request-correlator.js';
import type {
  AssistantMessage,
  ConnectorCapabilities,
  ConnectorEvent,
  EngineConnector,
} from '../connector.types.js';
import { isCorrelatableId } from './utils.js';

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
    this.#ws.send(JSON.stringify(message));
    return promise;
  }

  /**
   * Sends an assistant message to the server.
   * Fire-and-forget — the server does not send an ack for this message type.
   * Throws if the WebSocket is not connected.
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
      JSON.stringify({
        type: 'client.history.add_assistant_message',
        timestamp: performance.now(),
        sessionId: this.#sessionId,
        id: message.id,
        message: message.message,
      }),
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
      JSON.stringify({
        type: 'client.history.get',
        id: requestId,
        sessionId,
      }),
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
    try {
      const data = JSON.parse(event.data);
      if (
        data.type === 'engine.maelstrom.response' &&
        isCorrelatableId(data.requestId)
      ) {
        const requestId = MessageId(data.requestId);
        const resolved = this.#correlator.resolve(requestId, data.response);
        if (!resolved) {
          console.warn(
            `[WebSocketConnector] engine.maelstrom.response with no pending request: requestId=${data.requestId}`,
          );
        }
      } else if (
        data.type === 'engine.history.response' &&
        isCorrelatableId(data.requestId)
      ) {
        const requestId = MessageId(data.requestId);
        // safeParse at the wire boundary — a malformed payload (server bug,
        // schema drift, proxy that mangled the body) rejects the awaiting
        // caller with a useful error rather than resolving with a silently
        // coerced empty array.
        const parsed = SessionHistoryEntryArraySchema.safeParse(data.entries);
        if (!parsed.success) {
          const rejected = this.#historyCorrelator.reject(
            requestId,
            new Error(
              `engine.history.response: malformed entries (${parsed.error.issues[0]?.message ?? 'schema mismatch'})`,
            ),
          );
          if (!rejected) {
            // Stale id (timed out client-side, server replied late) AND the
            // payload was malformed — without this warn the contract violation
            // is silently swallowed.
            console.warn(
              `[WebSocketConnector] engine.history.response with malformed entries and no pending request: requestId=${data.requestId}`,
            );
          }
          return;
        }
        const resolved = this.#historyCorrelator.resolve(
          requestId,
          parsed.data,
        );
        if (!resolved) {
          console.warn(
            `[WebSocketConnector] engine.history.response with no pending request: requestId=${data.requestId}`,
          );
        }
      } else if (
        data.type === 'engine.error' &&
        isCorrelatableId(data.requestId)
      ) {
        // engine.error is shared across response types — reject both
        // correlators unconditionally so that if a request id happens to be
        // pending in both (the typed-isolation rationale of #historyCorrelator
        // assumes such collisions are possible), each caller observes the
        // error rather than silently waiting until its own timeout fires.
        // reject() is a no-op for unknown ids, so the redundant call is free.
        const requestId = MessageId(data.requestId);
        const error = new Error(data.error || data.message || 'Engine error');
        const inChart = this.#correlator.reject(requestId, error);
        const inHistory = this.#historyCorrelator.reject(requestId, error);
        if (!inChart && !inHistory) {
          // Most likely cause: post-timeout server failure delivery. The
          // chart/history paths warn on the same condition; symmetry here
          // keeps a real diagnostic from being silently swallowed.
          console.warn(
            `[WebSocketConnector] engine.error with no pending request: requestId=${data.requestId} error=${error.message}`,
          );
        }
      }
    } catch (err) {
      console.error(
        '[WebSocketConnector] Failed to parse message:',
        err,
        event.data,
      );
    }
  }
}
