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
 *   async process(request: ChartRequest): Promise<MaelstromResponse> {
 *     const res = await fetch('/api/process', { method: 'POST', body: JSON.stringify(request) });
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
  VoiceClientMessage,
  VoiceServerMessage,
} from '@maelstrom-co/protocol-old';
import type {
  ChartRequest,
  MaelstromResponse,
  MessageId,
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
  voice: boolean;
  /** Whether the connector supports bidirectional streaming */
  streaming: boolean;
  /** Whether the connector maintains a persistent connection (WebSocket vs HTTP) */
  stateful: boolean;
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
  | { type: 'disconnected'; clean: boolean; message: string }
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
 *   async process(request: ChartRequest): Promise<MaelstromResponse> {
 *     const res = await fetch('/api/process', {
 *       method: 'POST',
 *       body: JSON.stringify(request),
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
 *   async process(request: ChartRequest): Promise<MaelstromResponse> {
 *     // Send request, wait for response via correlator
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
 *     // Fire-and-forget — server does not send an ack for this message type
 *     this.ws?.send(JSON.stringify({ type: 'client.history.add_assistant_message', ...msg }));
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
   *   Voice connectors use this to set the session query parameter on the WS URL so that
   *   conversation history on the server shares a single namespace with engine requests.
   */
  connect(sessionId: SessionId): Promise<void>;

  /**
   * Close the transport connection.
   * For stateless transports (HTTP), this is a no-op.
   */
  disconnect(): Promise<void>;

  /**
   * Send a request to the engine and return the response.
   */
  process(request: ChartRequest): Promise<MaelstromResponse>;

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
   * ```
   *
   * ConnectionManager behavior:
   * - `clean: true` → No auto-reconnect (intentional disconnect)
   * - `clean: false` → Auto-reconnect with exponential backoff
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
   */
  addAssistantMessage(message: AssistantMessage): Promise<void>;
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
  id: MessageId;
  /** Message content */
  message: string;
}

// ============================================================================
// Audio Types for Voice Connector
// ============================================================================

/**
 * Audio chunk for voice input.
 */
export interface AudioChunk {
  /** Audio data as bytes */
  data: Uint8Array;
  /** Sample rate in Hz (e.g., 16000) */
  sampleRate: number;
  /** Encoding format (e.g., 'opus', 'pcm') */
  encoding: string;
  /** Whether this is the final chunk of an utterance */
  isFinal: boolean;
}

/**
 * Metadata for an audio frame received from the server.
 */
export interface AudioFrameMeta {
  /** Whether this audio frame can be cancelled (e.g., user interrupted) */
  cancellable: boolean;
}

/**
 * Flags byte layout for audio frame metadata.
 * First byte of each audio frame indicates metadata flags.
 */
export const AUDIO_FRAME_FLAGS = {
  /** Bit 0: Set if audio can be cancelled */
  CANCELLABLE: 0x01,
} as const;

// ============================================================================
// Voice Connector
// ============================================================================

/**
 * Extended connector with voice capabilities.
 *
 * Voice connectors support bidirectional audio streaming over a WebSocket
 * connection. All subscription methods return `Unsubscribe` for cleanup.
 */
export interface VoiceConnector extends EngineConnector {
  /**
   * Send an audio chunk to the server for transcription.
   */
  sendAudioChunk(chunk: AudioChunk): void;

  /**
   * Start listening for voice input.
   */
  startListening(language?: string): void;

  /**
   * Stop listening for voice input.
   */
  stopListening(): void;

  /**
   * Subscribe to voice messages from the server.
   */
  onVoiceMessage(callback: (message: VoiceServerMessage) => void): Unsubscribe;

  /**
   * Subscribe to binary audio output from the server (TTS).
   */
  onBinaryAudio(
    callback: (data: Uint8Array, meta: AudioFrameMeta) => void,
  ): Unsubscribe;

  /**
   * Send a voice message to the server.
   */
  sendVoiceMessage(message: VoiceClientMessage): void;
}
