/**
 * Connector interfaces and types for Maelstrom client.
 *
 * These interfaces define the contract between client and engine transport layer.
 * Connectors are a client concern — they handle the actual communication
 * mechanism (WebSocket, HTTP, etc.) with the Maelstrom engine.
 *
 * @example
 * ```typescript
 * // Minimal HTTP connector
 * class MyHttpConnector implements EngineConnector {
 *   readonly capabilities = { voice: false, streaming: false, stateful: false };
 *   async connect(_sessionId: SessionId): Promise<void> {}
 *   async disconnect(): Promise<void> {}
 *   async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
 *     const res = await fetch('/api/process', { method: 'POST', body: JSON.stringify(message) });
 *     return res.json();
 *   }
 *   subscribe(_handler: (event: ConnectorEvent) => void): Unsubscribe {
 *     return () => {}; // HTTP never fires transport events
 *   }
 *   async addAssistantMessage(msg: AssistantMessage): Promise<void> {
 *     const res = await fetch('/api/assistant-message', { method: 'POST', body: JSON.stringify(msg) });
 *     if (!res.ok) throw new Error(`HTTP ${res.status}`);
 *   }
 * }
 *
 * // WebSocket connector
 * const connector = new WebSocketConnector({ url: 'wss://api.example.com/ws' });
 * const manager = new ConnectionManager(connector, { maxRetries: 3 });
 * await manager.connect();
 * ```
 */

import type {
  ChartRequestMessage,
  MaelstromResponse,
  MessageId,
  SessionHistoryEntry,
  SessionId,
} from '@maelstrom-co/protocol';

import type { Unsubscribe } from '../types.js';

// ============================================================================
// Connection Status
// ============================================================================

/**
 * Possible statuses of a connection to the engine.
 */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

// ============================================================================
// Circuit Status
// ============================================================================

/**
 * Circuit-breaker phase for engine connection attempts.
 *
 * `closed` permits normal attempts, `open` rejects explicit
 * {@link ConnectionManager.connect} calls, and `half_open` marks the automatic
 * recovery probe started after the reset timeout.
 */
export type CircuitStatus = 'closed' | 'open' | 'half_open';

// ============================================================================
// Connector Capabilities
// ============================================================================

/**
 * Capabilities of a connector implementation.
 *
 * These are metadata declarations for consumers (e.g., UI that wants to
 * show/hide a voice button). The ConnectionManager does NOT use these flags
 * to change its behavior — it is transport-agnostic.
 */
export interface ConnectorCapabilities {
  /** Whether the connector supports voice/audio streaming */
  readonly voice: boolean;
  /** Whether the connector supports bidirectional streaming */
  readonly streaming: boolean;
  /** Whether the connector maintains a persistent connection (WebSocket vs HTTP) */
  readonly stateful: boolean;
}

// ============================================================================
// Connector Events
// ============================================================================

/**
 * Transport-level events emitted by a connector via `subscribe()`.
 *
 * These are the only events the ConnectionManager needs from a connector:
 * - `'disconnected'`: the transport closed, cleanly or unexpectedly.
 * - `'error'`: a transport-level error occurred (distinct from a disconnection).
 *
 * There is intentionally no `'connected'` event. `connect()` resolving is the
 * signal that the connection is ready — no separate subscription needed.
 */
export type ConnectorEvent =
  | {
      type: 'disconnected';
      clean: boolean;
      message: string;
      retryable?: boolean;
    }
  | { type: 'error'; error: Error };

// ============================================================================
// Engine Connector
// ============================================================================

/**
 * Interface for communicating with the Maelstrom engine.
 *
 * ## Overview
 *
 * An EngineConnector is a **pure transport layer** with 4 responsibilities:
 * 1. Opening/closing the connection (`connect`, `disconnect`)
 * 2. Sending requests and receiving responses (`process`)
 * 3. Notifying when the transport closes or errors (`subscribe`)
 * 4. Declaring capabilities (`capabilities`)
 *
 * ## Event System (Critical for ConnectionManager)
 *
 * The `subscribe()` method is how your connector notifies ConnectionManager
 * of transport-level events. This enables auto-reconnect and error handling.
 *
 * ### Required Events for Stateful Connectors (WebSocket, WebRTC):
 *
 * ```typescript
 * // 1. When transport closes (cleanly or unexpectedly)
 * handler({ type: 'disconnected', clean: true, message: 'User closed connection' });
 *
 * // 2. When transport errors occur
 * handler({ type: 'error', error: new Error('WebSocket error') });
 * ```
 *
 * ### ConnectionManager Behavior:
 *
 * - `clean: true` → No auto-reconnect (user intentionally disconnected)
 * - `clean: false` → Triggers auto-reconnect with exponential backoff
 * - `retryable: false` → Opens the circuit breaker immediately instead of
 *   auto-reconnecting, regardless of `clean`. Set this when the server closed
 *   the connection for a reason retrying cannot fix (e.g. WebSocket close code
 *   1008 "Policy Violation" per RFC 6455 — the server is rejecting this
 *   client, not failing transiently). Omit it (the default) to keep the
 *   existing `clean`-based behavior.
 * - `error` events → Logged for monitoring, may trigger state change
 *
 * ### No 'connected' Event:
 *
 * There is intentionally NO `'connected'` event. `connect()` resolving
 * is the signal that the connection is ready. The event system is only
 * for negative cases (disconnects and errors).
 *
 * ## Implementation Checklist
 *
 * - [ ] `connect()`: Resolve when ready, reject on failure (don't retry)
 * - [ ] `disconnect()`: Close transport, clean up resources, reject pending requests
 * - [ ] `process()`: Handle request/response correlation, throw on errors
 * - [ ] `subscribe()`: Emit `disconnected` on close, `error` on errors
 * - [ ] `capabilities`: Set `stateful: true` for WebSocket/WebRTC
 * - [ ] `addAssistantMessage()`: Inject assistant message into conversation history
 *
 * ## Minimal HTTP Example (Stateless)
 *
 * ```typescript
 * class HttpConnector implements EngineConnector {
 *   readonly capabilities = { voice: false, streaming: false, stateful: false };
 *
 *   async connect(_sessionId: SessionId): Promise<void> {
 *     // Optional: health check
 *   }
 *
 *   async disconnect(): Promise<void> {
 *     // No-op for HTTP
 *   }
 *
 *   async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
 *     const res = await fetch('/api/process', {
 *       method: 'POST',
 *       body: JSON.stringify(message),
 *     });
 *     if (!res.ok) throw new Error(`HTTP ${res.status}`);
 *     return res.json();
 *   }
 *
 *   subscribe(_handler: (event: ConnectorEvent) => void): Unsubscribe {
 *     // HTTP never fires transport events
 *     return () => {};
 *   }
 *
 *   async addAssistantMessage(msg: AssistantMessage): Promise<void> {
 *     const res = await fetch('/api/assistant-message', {
 *       method: 'POST',
 *       body: JSON.stringify(msg),
 *     });
 *     if (!res.ok) throw new Error(`HTTP ${res.status}`);
 *   }
 * }
 * ```
 *
 * ## Minimal WebSocket Example (Stateful)
 *
 * ```typescript
 * class WebSocketConnector implements EngineConnector {
 *   readonly capabilities = { voice: false, streaming: true, stateful: true };
 *   private ws: WebSocket | null = null;
 *   private handlers = new Set<(event: ConnectorEvent) => void>();
 *
 *   async connect(_sessionId: SessionId): Promise<void> {
 *     return new Promise((resolve, reject) => {
 *       this.ws = new WebSocket(this.url);
 *
 *       const timeout = setTimeout(() => {
 *         this.ws?.close();
 *         reject(new Error('Connection timeout'));
 *       }, 10000);
 *
 *       this.ws.onopen = () => {
 *         clearTimeout(timeout);
 *         this.setupEventHandlers();
 *         resolve();
 *       };
 *
 *       this.ws.onerror = () => {
 *         clearTimeout(timeout);
 *         reject(new Error('Connection failed'));
 *       };
 *     });
 *   }
 *
 *   async disconnect(): Promise<void> {
 *     this.ws?.close();
 *     this.ws = null;
 *   }
 *
 *   async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
 *     // Send envelope, wait for response correlated by message.id
 *   }
 *
 *   subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe {
 *     this.handlers.add(handler);
 *     return () => this.handlers.delete(handler);
 *   }
 *
 *   private setupEventHandlers(): void {
 *     this.ws!.onclose = (event) => {
 *       // NOTIFY CONNECTIONMANAGER
 *       this.handlers.forEach(h => h({
 *         type: 'disconnected',
 *         clean: event.code === 1000,
 *         message: event.reason || `Closed with code ${event.code}`,
 *       }));
 *     };
 *
 *     this.ws!.onerror = () => {
 *       // NOTIFY CONNECTIONMANAGER
 *       this.handlers.forEach(h => h({
 *         type: 'error',
 *         error: new Error('WebSocket error'),
 *       }));
 *     };
 *   }
 *
 *   async addAssistantMessage(msg: AssistantMessage): Promise<void> {
 *     // Fire-and-forget — server does not send an ack for this message type.
 *     // Translate to the real assistant_message envelope and encode it.
 *     this.ws?.send(encodeEnvelope(AssistantInjectionMessage({
 *       sessionId: this.sessionId,
 *       content: msg.message,
 *       id: msg.id,
 *     })));
 *   }
 * }
 * ```
 *
 * @see CONNECTOR_GUIDE.md for complete documentation
 */
export interface EngineConnector {
  /**
   * Connector capabilities. Metadata for consumers — the ConnectionManager
   * does not use these for flow control.
   */
  readonly capabilities: ConnectorCapabilities;

  /**
   * Establish the transport connection.
   * Resolves when the connection is ready to use.
   * Throws if the connection cannot be established (ConnectionManager retries).
   *
   * For stateless transports (HTTP), this may be a no-op or a health check.
   *
   * @param sessionId - The canonical session ID generated by the Provider/Orchestrator.
   *   Transports may use it to namespace server-side state (e.g. conversation history)
   *   so every channel of a session shares a single namespace with engine requests.
   */
  connect(sessionId: SessionId): Promise<void>;

  /**
   * Close the transport connection.
   * For stateless transports (HTTP), this is a no-op.
   */
  disconnect(): Promise<void>;

  /**
   * Send a chart_request envelope to the engine and return the response.
   *
   * The envelope ({@link ChartRequestMessage}) carries `sessionId`, `id`, and
   * `timestamp` — used by the engine for response correlation and session
   * routing. Implementations should use `message.id` for any request/response
   * correlation logic.
   *
   * Round-trip guarantee: the returned `MaelstromResponse.requestId` always
   * equals `message.id`, regardless of the underlying transport.
   */
  process(message: ChartRequestMessage): Promise<MaelstromResponse>;

  /**
   * Subscribe to transport-level events.
   *
   * **THIS IS THE CRITICAL METHOD FOR CONNECTIONMANAGER**
   *
   * The ConnectionManager uses these events to:
   * - Detect unexpected disconnections and trigger auto-reconnect
   * - Update connection state (disconnected, error)
   * - Log transport errors for monitoring
   *
   * ## Events to Emit:
   *
   * ### `disconnected` (REQUIRED for stateful connectors)
   * Emit when the transport closes (cleanly or unexpectedly).
   *
   * ```typescript
   * // Clean disconnect (user clicked disconnect button)
   * handler({ type: 'disconnected', clean: true, message: 'User disconnected' });
   *
   * // Unexpected disconnect (network failure, server crash)
   * handler({ type: 'disconnected', clean: false, message: 'Network error' });
   *
   * // Server rejected this client outright (e.g. WebSocket close code 1008) —
   * // retrying would just be rejected again, so flag it non-retryable.
   * handler({ type: 'disconnected', clean: false, message: 'Policy violation', retryable: false });
   * ```
   *
   * ConnectionManager behavior:
   * - `clean: true` → No auto-reconnect (intentional disconnect)
   * - `clean: false` → Auto-reconnect with exponential backoff
   * - `retryable: false` → Opens the circuit breaker immediately instead of
   *   auto-reconnecting, regardless of `clean`. Omit for the default
   *   `clean`-based behavior.
   *
   * ### `error` (Optional but recommended)
   * Emit when transport-level errors occur (distinct from disconnects).
   *
   * ```typescript
   * handler({ type: 'error', error: new Error('WebSocket error') });
   * ```
   *
   * ## Implementation Pattern:
   *
   * ```typescript
   * subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe {
   *   // Store the handler
   *   this.handlers.add(handler);
   *
   *   // Set up transport event listeners
   *   this.ws.onclose = (event) => {
   *     handler({
   *       type: 'disconnected',
   *       clean: event.code === 1000,
   *       message: event.reason || `Closed with code ${event.code}`,
   *     });
   *   };
   *
   *   this.ws.onerror = () => {
   *     handler({ type: 'error', error: new Error('WebSocket error') });
   *   };
   *
   *   // Return unsubscribe function
   *   return () => this.handlers.delete(handler);
   * }
   * ```
   *
   * ## HTTP (Stateless) Implementation:
   *
   * ```typescript
   * subscribe(_handler: (event: ConnectorEvent) => void): Unsubscribe {
   *   // HTTP never emits transport events
   *   return () => {};
   * }
   * ```
   *
   * @param handler - Callback invoked when transport events occur
   * @returns Unsubscribe function to remove the handler
   *
   * @see CONNECTOR_GUIDE.md for detailed examples
   */
  subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe;

  /**
   * Add an assistant message to conversation history without LLM processing.
   * Used for programmatic messages (greetings, notifications).
   *
   * This legacy capability is fire-and-forget: it resolves after the transport
   * accepts the send and does not confirm insertion. Use
   * {@link AcknowledgedAssistantConnector.addAssistantMessageAcknowledged} when
   * dependent side effects require a correlated engine outcome.
   */
  addAssistantMessage(message: AssistantMessage): Promise<void>;

  /**
   * Fetch the engine-recorded history for the given session.
   *
   * Used by clients that persist a session id and need to rehydrate the
   * conversation after a refresh, on a different device, or in a parallel
   * tab. The session id is supplied explicitly (not taken from the connector's
   * current connection) so callers can fetch any session they have an id for —
   * including a session that predates the current orchestrator instance.
   *
   * Implementations translate transport / engine errors into thrown `Error`s,
   * matching the existing `process` and `addAssistantMessage` shape. Whether
   * an unknown or empty session resolves to `[]` or rejects is the engine's
   * call (the reference engine resolves to `[]`); connectors do not synthesize
   * that behavior themselves.
   */
  getHistory(sessionId: SessionId): Promise<readonly SessionHistoryEntry[]>;
}

// ============================================================================
// Wire Engine Error
// ============================================================================

/**
 * The error a connector rejects a pending request with when the engine host
 * reports a failure over the wire.
 *
 * Surfaces the `engine.error` envelope's `error` string as the message. `code`
 * carries whatever machine-readable tag the host attached — either an engine
 * `EngineError` tag or an `EnvelopeErrorKind` (`'invalid_json'` /
 * `'invalid_envelope'`) when the host rejected the client's own frame. There
 * is deliberately no closed taxonomy: the wire contract does not fix the set of
 * codes, so consumers must handle an unknown or absent `code` gracefully rather
 * than switching exhaustively over it.
 */
export class WireEngineError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'WireEngineError';
    if (code !== undefined) this.code = code;
  }
}

// ============================================================================
// Push Message Connector
// ============================================================================

/**
 * Extension for connectors that support server-initiated (push) messages.
 *
 * Push messages are unsolicited responses from the engine, typically triggered
 * by voice interactions where the engine responds without a client request.
 *
 * @example
 * ```typescript
 * if ('onPushMessage' in connector) {
 *   (connector as PushConnector).onPushMessage((response) => {
 *     commandProcessor.setLayout(response.layout);
 *     commandProcessor.executeActions(response.executionPlan);
 *   });
 * }
 * ```
 */
export interface PushConnector extends EngineConnector {
  /**
   * Subscribe to unsolicited responses from the engine.
   */
  onPushMessage(callback: (response: MaelstromResponse) => void): Unsubscribe;
}

// ============================================================================
// Assistant Message
// ============================================================================

/**
 * Message to inject into assistant conversation history.
 * The session ID is not required here — the connector supplies it from the
 * session established during connect().
 */
export interface AssistantMessage {
  /** Unique message identifier. Used for deduplication and history correlation. */
  readonly id: MessageId;
  /** Message content */
  readonly message: string;
}

/**
 * Result of an acknowledged assistant-message insertion.
 *
 * - `inserted`: the engine appended the message to session history.
 * - `deduped`: the engine already held a message with the same id, so it
 *   appended nothing.
 *
 * Callers use this to decide whether side effects tied to the message (for
 * example a caption or speech playback) already ran in a previous attempt.
 * Greeting flows treat `deduped` without a retained `inserted` as “already
 * handled” and suppress caption and speech for that greeting forever.
 */
export type AssistantMessageOutcome = 'inserted' | 'deduped';

/**
 * Connector that reports whether an assistant message was inserted or deduped.
 *
 * Optional capability: {@link EngineConnector.addAssistantMessage} stays
 * fire-and-forget. Detect support with
 * {@link isAcknowledgedAssistantConnector}.
 */
export interface AcknowledgedAssistantConnector extends EngineConnector {
  /**
   * Insert an assistant message and wait for the engine outcome.
   *
   * Unlike legacy {@link EngineConnector.addAssistantMessage}, this does not
   * resolve merely because the transport accepted the send. It rejects when
   * request construction or sending fails, the transport is not connected,
   * the engine reports an error, the connection closes, or the bounded
   * acknowledgement wait expires. A silent legacy server therefore times out
   * rather than producing a false insertion result.
   */
  addAssistantMessageAcknowledged(
    message: AssistantMessage,
  ): Promise<AssistantMessageOutcome>;
}

/**
 * Narrow an {@link EngineConnector} to one that supports acknowledged
 * assistant-message insertion.
 */
export function isAcknowledgedAssistantConnector(
  connector: EngineConnector,
): connector is AcknowledgedAssistantConnector {
  return (
    'addAssistantMessageAcknowledged' in connector &&
    typeof connector.addAssistantMessageAcknowledged === 'function'
  );
}

/** Connector-owned error or cancellation evidence, independent of unclassified application errors. */
export type ConnectorFailureKind =
  | 'cancelled'
  | 'transport'
  | 'timeout'
  | 'invalid_response';

/** An error or cancellation whose origin was established by a connector at the transport boundary. */
export class ConnectorError extends Error {
  /** Established failure origin; arbitrary error messages are never used for classification. */
  readonly kind: ConnectorFailureKind;

  /** Creates a classified connector failure while retaining its message and optional cause. */
  constructor(
    kind: ConnectorFailureKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ConnectorError';
    this.kind = kind;
  }
}

const connectorCancellations = new WeakSet<Error>();

export function markConnectorCancellation<Failure extends Error>(
  error: Failure,
): Failure {
  connectorCancellations.add(error);
  return error;
}

export function connectorFailureKind(
  error: Error,
): ConnectorFailureKind | undefined {
  return connectorCancellations.has(error)
    ? 'cancelled'
    : error instanceof ConnectorError
      ? error.kind
      : undefined;
}
