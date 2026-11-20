---
editUrl: false
next: false
prev: false
title: "EngineConnector"
---

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:286

Interface for communicating with the Maelstrom engine.

## Overview

An EngineConnector is a **pure transport layer** with 4 responsibilities:
1. Opening/closing the connection (`connect`, `disconnect`)
2. Sending requests and receiving responses (`process`)
3. Notifying when the transport closes or errors (`subscribe`)
4. Declaring capabilities (`capabilities`)

## Event System (Critical for ConnectionManager)

The `subscribe()` method is how your connector notifies ConnectionManager
of transport-level events. This enables auto-reconnect and error handling.

### Required Events for Stateful Connectors (WebSocket, WebRTC):

```typescript
// 1. When transport closes (cleanly or unexpectedly)
handler({ type: 'disconnected', clean: true, message: 'User closed connection' });

// 2. When transport errors occur
handler({ type: 'error', error: new Error('WebSocket error') });
```

### ConnectionManager Behavior:

- `clean: true` → No auto-reconnect (user intentionally disconnected)
- `clean: false` → Triggers auto-reconnect with exponential backoff
- `retryable: false` → Opens the circuit breaker immediately instead of
  auto-reconnecting, regardless of `clean`. Set this when the server closed
  the connection for a reason retrying cannot fix (e.g. WebSocket close code
  1008 "Policy Violation" per RFC 6455 — the server is rejecting this
  client, not failing transiently). Omit it (the default) to keep the
  existing `clean`-based behavior.
- `error` events → Logged for monitoring, may trigger state change

### No 'connected' Event:

There is intentionally NO `'connected'` event. `connect()` resolving
is the signal that the connection is ready. The event system is only
for negative cases (disconnects and errors).

## Implementation Checklist

- [ ] `connect()`: Resolve when ready, reject on failure (don't retry)
- [ ] `disconnect()`: Close transport, clean up resources, reject pending requests
- [ ] `process()`: Handle request/response correlation, throw on errors
- [ ] `subscribe()`: Emit `disconnected` on close, `error` on errors
- [ ] `capabilities`: Set `stateful: true` for WebSocket/WebRTC
- [ ] `addAssistantMessage()`: Inject assistant message into conversation history

## Minimal HTTP Example (Stateless)

```typescript
class HttpConnector implements EngineConnector {
  readonly capabilities = { voice: false, streaming: false, stateful: false };

  async connect(_sessionId: SessionId): Promise<void> {
    // Optional: health check
  }

  async disconnect(): Promise<void> {
    // No-op for HTTP
  }

  async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
    const res = await fetch('/api/process', {
      method: 'POST',
      body: JSON.stringify(message),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  subscribe(_handler: (event: ConnectorEvent) => void): Unsubscribe {
    // HTTP never fires transport events
    return () => {};
  }

  async addAssistantMessage(msg: AssistantMessage): Promise<void> {
    const res = await fetch('/api/assistant-message', {
      method: 'POST',
      body: JSON.stringify(msg),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }
}
```

## Minimal WebSocket Example (Stateful)

```typescript
class WebSocketConnector implements EngineConnector {
  readonly capabilities = { voice: false, streaming: true, stateful: true };
  private ws: WebSocket | null = null;
  private handlers = new Set<(event: ConnectorEvent) => void>();

  async connect(_sessionId: SessionId): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      const timeout = setTimeout(() => {
        this.ws?.close();
        reject(new Error('Connection timeout'));
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.setupEventHandlers();
        resolve();
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Connection failed'));
      };
    });
  }

  async disconnect(): Promise<void> {
    this.ws?.close();
    this.ws = null;
  }

  async process(message: ChartRequestMessage): Promise<MaelstromResponse> {
    // Send envelope, wait for response correlated by message.id
  }

  subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private setupEventHandlers(): void {
    this.ws!.onclose = (event) => {
      // NOTIFY CONNECTIONMANAGER
      this.handlers.forEach(h => h({
        type: 'disconnected',
        clean: event.code === 1000,
        message: event.reason || `Closed with code ${event.code}`,
      }));
    };

    this.ws!.onerror = () => {
      // NOTIFY CONNECTIONMANAGER
      this.handlers.forEach(h => h({
        type: 'error',
        error: new Error('WebSocket error'),
      }));
    };
  }

  async addAssistantMessage(msg: AssistantMessage): Promise<void> {
    // Fire-and-forget — server does not send an ack for this message type.
    // Translate to the real assistant_message envelope and encode it.
    this.ws?.send(encodeEnvelope(AssistantInjectionMessage({
      sessionId: this.sessionId,
      content: msg.message,
      id: msg.id,
    })));
  }
}
```

## See

CONNECTOR_GUIDE.md for complete documentation

## Extended by

- [`AcknowledgedAssistantConnector`](/reference/client/interfaces/acknowledgedassistantconnector/)
- [`PushConnector`](/reference/client/interfaces/pushconnector/)

## Properties

### capabilities

> `readonly` **capabilities**: [`ConnectorCapabilities`](/reference/client/interfaces/connectorcapabilities/)

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:291

Connector capabilities. Metadata for consumers — the ConnectionManager
does not use these for flow control.

## Methods

### addAssistantMessage()

> **addAssistantMessage**(`message`): `Promise`\<`void`\>

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:416

Add an assistant message to conversation history without LLM processing.
Used for programmatic messages (greetings, notifications).

This legacy capability is fire-and-forget: it resolves after the transport
accepts the send and does not confirm insertion. Use
[AcknowledgedAssistantConnector.addAssistantMessageAcknowledged](/reference/client/interfaces/acknowledgedassistantconnector/#addassistantmessageacknowledged) when
dependent side effects require a correlated engine outcome.

#### Parameters

##### message

[`AssistantMessage`](/reference/client/interfaces/assistantmessage/)

#### Returns

`Promise`\<`void`\>

***

### connect()

> **connect**(`sessionId`): `Promise`\<`void`\>

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:304

Establish the transport connection.
Resolves when the connection is ready to use.
Throws if the connection cannot be established (ConnectionManager retries).

For stateless transports (HTTP), this may be a no-op or a health check.

#### Parameters

##### sessionId

[`SessionId`](/reference/client/type-aliases/sessionid/)

The canonical session ID generated by the Provider/Orchestrator.
  Transports may use it to namespace server-side state (e.g. conversation history)
  so every channel of a session shares a single namespace with engine requests.

#### Returns

`Promise`\<`void`\>

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:310

Close the transport connection.
For stateless transports (HTTP), this is a no-op.

#### Returns

`Promise`\<`void`\>

***

### getHistory()

> **getHistory**(`sessionId`): `Promise`\<readonly `SessionHistoryEntry`[]\>

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:433

Fetch the engine-recorded history for the given session.

Used by clients that persist a session id and need to rehydrate the
conversation after a refresh, on a different device, or in a parallel
tab. The session id is supplied explicitly (not taken from the connector's
current connection) so callers can fetch any session they have an id for —
including a session that predates the current orchestrator instance.

Implementations translate transport / engine errors into thrown `Error`s,
matching the existing `process` and `addAssistantMessage` shape. Whether
an unknown or empty session resolves to `[]` or rejects is the engine's
call (the reference engine resolves to `[]`); connectors do not synthesize
that behavior themselves.

#### Parameters

##### sessionId

[`SessionId`](/reference/client/type-aliases/sessionid/)

#### Returns

`Promise`\<readonly `SessionHistoryEntry`[]\>

***

### process()

> **process**(`message`): `Promise`\<`MaelstromResponse`\>

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:323

Send a chart_request envelope to the engine and return the response.

The envelope (ChartRequestMessage) carries `sessionId`, `id`, and
`timestamp` — used by the engine for response correlation and session
routing. Implementations should use `message.id` for any request/response
correlation logic.

Round-trip guarantee: the returned `MaelstromResponse.requestId` always
equals `message.id`, regardless of the underlying transport.

#### Parameters

##### message

`ChartRequestMessage`

#### Returns

`Promise`\<`MaelstromResponse`\>

***

### subscribe()

> **subscribe**(`handler`): [`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:405

Subscribe to transport-level events.

**THIS IS THE CRITICAL METHOD FOR CONNECTIONMANAGER**

The ConnectionManager uses these events to:
- Detect unexpected disconnections and trigger auto-reconnect
- Update connection state (disconnected, error)
- Log transport errors for monitoring

## Events to Emit:

### `disconnected` (REQUIRED for stateful connectors)
Emit when the transport closes (cleanly or unexpectedly).

```typescript
// Clean disconnect (user clicked disconnect button)
handler({ type: 'disconnected', clean: true, message: 'User disconnected' });

// Unexpected disconnect (network failure, server crash)
handler({ type: 'disconnected', clean: false, message: 'Network error' });

// Server rejected this client outright (e.g. WebSocket close code 1008) —
// retrying would just be rejected again, so flag it non-retryable.
handler({ type: 'disconnected', clean: false, message: 'Policy violation', retryable: false });
```

ConnectionManager behavior:
- `clean: true` → No auto-reconnect (intentional disconnect)
- `clean: false` → Auto-reconnect with exponential backoff
- `retryable: false` → Opens the circuit breaker immediately instead of
  auto-reconnecting, regardless of `clean`. Omit for the default
  `clean`-based behavior.

### `error` (Optional but recommended)
Emit when transport-level errors occur (distinct from disconnects).

```typescript
handler({ type: 'error', error: new Error('WebSocket error') });
```

## Implementation Pattern:

```typescript
subscribe(handler: (event: ConnectorEvent) => void): Unsubscribe {
  // Store the handler
  this.handlers.add(handler);

  // Set up transport event listeners
  this.ws.onclose = (event) => {
    handler({
      type: 'disconnected',
      clean: event.code === 1000,
      message: event.reason || `Closed with code ${event.code}`,
    });
  };

  this.ws.onerror = () => {
    handler({ type: 'error', error: new Error('WebSocket error') });
  };

  // Return unsubscribe function
  return () => this.handlers.delete(handler);
}
```

## HTTP (Stateless) Implementation:

```typescript
subscribe(_handler: (event: ConnectorEvent) => void): Unsubscribe {
  // HTTP never emits transport events
  return () => {};
}
```

#### Parameters

##### handler

(`event`) => `void`

Callback invoked when transport events occur

#### Returns

[`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

Unsubscribe function to remove the handler

#### See

CONNECTOR_GUIDE.md for detailed examples
