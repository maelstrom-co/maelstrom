import type {
  ChartRequest,
  MaelstromResponse,
} from '@maelstrom-co/protocol-old';
import type { Unsubscribe } from '../../types.js';
import { RequestCorrelator } from '../../utils/request-correlator.js';
import type {
  AssistantMessage,
  ConnectorCapabilities,
  ConnectorEvent,
  EngineConnector,
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
  #correlator = new RequestCorrelator();
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
  async connect(): Promise<void> {
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
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Closes the WebSocket connection and rejects all pending requests.
   */
  async disconnect(): Promise<void> {
    this.#correlator.rejectAll(new Error('Disconnected'));
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
   * Sends a request and waits for the correlated response.
   */
  async process(request: ChartRequest): Promise<MaelstromResponse> {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const promise = this.#correlator.create(request.id, this.#timeout);
    this.#ws.send(JSON.stringify(request));
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

    this.#ws.send(
      JSON.stringify({
        type: 'client.history.add_assistant_message',
        timestamp: performance.now(),
        sessionId: message.sessionId,
        message: message.message,
      }),
    );
  }

  #setupEventHandlers(): void {
    if (!this.#ws) return;

    this.#ws.onmessage = (event) => {
      this.#handleMessage(event);
    };

    this.#ws.onclose = (event) => {
      this.#correlator.rejectAll(new Error('WebSocket closed'));
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
      if (data.type === 'engine.maelstrom.response' && data.requestId) {
        this.#correlator.resolve(data.requestId, data.response);
      } else if (data.type === 'error' && data.requestId) {
        this.#correlator.reject(
          data.requestId,
          new Error(data.message || 'Engine error'),
        );
      }
    } catch {
      console.error(
        '[WebSocketConnector] Failed to parse message:',
        event.data,
      );
    }
  }
}
