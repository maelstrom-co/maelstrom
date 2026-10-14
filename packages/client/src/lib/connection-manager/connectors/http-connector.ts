import type {
  ChartRequestMessage,
  MaelstromResponse,
  SessionHistoryEntry,
  SessionId,
} from '@maelstrom-co/protocol';
import { SessionHistoryEntryArraySchema } from '@maelstrom-co/protocol';
import type { Unsubscribe } from '../../types.js';
import type {
  AssistantMessage,
  ConnectorCapabilities,
  ConnectorEvent,
  EngineConnector,
} from '../connector.types.js';
import {
  ConnectorError,
  markConnectorCancellation,
} from '../connector.types.js';

function transportFailure(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'AbortError')
    return markConnectorCancellation(error);
  return new ConnectorError(
    'transport',
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}

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
 * import { ChartRequestMessage, SessionId } from '@maelstrom-co/protocol';
 *
 * const connector = new HttpConnector({
 *   baseUrl: 'https://api.example.com',
 *   timeout: 30000,
 *   headers: { 'Authorization': 'Bearer token' },
 * });
 *
 * const manager = new ConnectionManager(store, connector);
 * await manager.connect(SessionId('session-1'));
 *
 * const envelope = ChartRequestMessage({
 *   sessionId: SessionId('session-1'),
 *   request: chartRequestPayload,
 * });
 * const response = await connector.process(envelope);
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
   *
   * Note: the sessionId is not stored because HTTP requests carry session context
   * in the request body. Subclasses that need session correlation should override
   * this method and store the sessionId.
   */
  async connect(_sessionId: SessionId): Promise<void> {}

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
   * Sends a chart_request envelope to the API endpoint.
   */
  async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
    return this.#postJson<MaelstromResponse>('/process', message);
  }

  async addAssistantMessage(message: AssistantMessage): Promise<void> {
    await this.#postJson('/assistant-message', message);
  }

  /**
   * Fetch the engine-recorded history for a session via POST `/history`.
   *
   * POST (not GET) keeps the request body symmetric with `/process` and
   * `/assistant-message`, lets clients send opaque session ids without URL
   * encoding concerns, and avoids accidental caching by intermediaries that
   * cache GET responses.
   */
  async getHistory(
    sessionId: SessionId,
  ): Promise<readonly SessionHistoryEntry[]> {
    const raw = await this.#postJson<unknown>('/history', { sessionId });
    const parsed = SessionHistoryEntryArraySchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `HttpConnector.getHistory: /history returned a malformed payload (${parsed.error.issues[0]?.message ?? 'schema mismatch'})`,
      );
    }
    return parsed.data;
  }

  /**
   * Shared POST helper with timeout, headers, and error handling.
   */
  async #postJson<T = unknown>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeout);

    try {
      const response = await fetch(`${this.#baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.#headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).catch((error) => {
        throw transportFailure(error);
      });

      const text = await response.text().catch((error) => {
        throw transportFailure(error);
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);

      try {
        return (text ? JSON.parse(text) : undefined) as T;
      } catch (error) {
        throw new ConnectorError(
          'invalid_response',
          error instanceof Error ? error.message : String(error),
          { cause: error },
        );
      }
    } catch (error) {
      if (timedOut)
        throw new ConnectorError(
          'timeout',
          `HTTP ${path} timed out after ${this.#timeout}ms`,
          { cause: error },
        );
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
