import type {
  ChartRequest,
  MaelstromResponse,
} from '@maelstrom-co/protocol-old';
import type { Unsubscribe } from '../../types.js';
import type {
  AssistantMessage,
  ConnectorCapabilities,
  ConnectorEvent,
  EngineConnector,
} from '../connector.types.js';

/**
 * Configuration options for HTTP connector.
 */
export interface HttpConnectorOptions {
  /** Base URL for the API endpoint */
  baseUrl: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Additional headers to include in requests */
  headers?: Record<string, string>;
}

/**
 * HTTP connector for stateless API communication.
 *
 * HTTP connections are per-request, so `connect()` and `disconnect()` are
 * no-ops, and `subscribe()` never fires any events. Useful for traditional
 * REST APIs.
 *
 * @example
 * ```typescript
 * import { HttpConnector } from '@maelstrom-co/client';
 *
 * const connector = new HttpConnector({
 *   baseUrl: 'https://api.example.com',
 *   timeout: 30000,
 *   headers: { 'Authorization': 'Bearer token' },
 * });
 *
 * const manager = new ConnectionManager(store, connector);
 * await manager.connect();
 * const response = await connector.process(request);
 * ```
 */
export class HttpConnector implements EngineConnector {
  readonly #baseUrl: string;
  readonly #timeout: number;
  readonly #headers: Record<string, string>;

  readonly capabilities: ConnectorCapabilities = {
    voice: false,
    streaming: false,
    stateful: false,
  };

  constructor(options: HttpConnectorOptions) {
    this.#baseUrl = options.baseUrl;
    this.#timeout = options.timeout ?? 30000;
    this.#headers = options.headers ?? {};
  }

  /**
   * No-op. HTTP is per-request — there is no persistent connection to establish.
   * Override this to implement a health check if desired.
   */
  async connect(): Promise<void> {}

  /**
   * No-op. HTTP is stateless — nothing to clean up.
   */
  async disconnect(): Promise<void> {}

  /**
   * HTTP never fires transport events. Returns an unsubscribe no-op.
   */
  subscribe(_handler: (event: ConnectorEvent) => void): Unsubscribe {
    return () => {};
  }

  /**
   * Sends a request to the API endpoint.
   */
  async process(request: ChartRequest): Promise<MaelstromResponse> {
    return this.#postJson<MaelstromResponse>('/process', request);
  }

  async addAssistantMessage(message: AssistantMessage): Promise<void> {
    await this.#postJson('/assistant-message', message);
  }

  /**
   * Shared POST helper with timeout, headers, and error handling.
   */
  async #postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.#timeout);

    try {
      const response = await fetch(`${this.#baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.#headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
