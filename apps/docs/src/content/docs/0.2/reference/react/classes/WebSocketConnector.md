---
editUrl: false
next: false
prev: false
title: "WebSocketConnector"
---

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:83

WebSocket connector for real-time bidirectional communication.

This connector is a thin wrapper around the WebSocket API. It:
- Opens/closes WebSocket connections
- Sends/receives messages with request/response correlation
- Reports transport events via `subscribe()`

State management, retry logic, and circuit breaker patterns are handled
by ConnectionManager which consumes the transport events.

## Example

```typescript
import { ConnectionManager, WebSocketConnector } from '@maelstrom-co/client';

const connector = new WebSocketConnector({
  url: 'wss://api.example.com/ws',
});

const manager = new ConnectionManager(store, connector);
await manager.connect(); // ConnectionManager handles state & retries
```

## Implements

- `AcknowledgedAssistantConnector`

## Constructors

### Constructor

> **new WebSocketConnector**(`options`): `WebSocketConnector`

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:90

#### Parameters

##### options

`WebSocketConnectorOptions`

#### Returns

`WebSocketConnector`

## Properties

### capabilities

> `readonly` **capabilities**: `ConnectorCapabilities`

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:85

Connector capabilities. Metadata for consumers — the ConnectionManager
does not use these for flow control.

#### Implementation of

`AcknowledgedAssistantConnector.capabilities`

## Methods

### addAssistantMessage()

> **addAssistantMessage**(`message`): `Promise`\<`void`\>

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:160

Sends an assistant message to the server.
Fire-and-forget: sends the legacy `assistant_message` envelope, for which
the server sends no result frame, and resolves after the socket accepts the
send. Use [addAssistantMessageAcknowledged](/reference/react/classes/websocketconnector/#addassistantmessageacknowledged) when persistence must be
confirmed before a dependent side effect.
Throws if the WebSocket is not connected, construction rejects malformed
content, or the socket cannot accept the send. Later Engine insertion
failures are intentionally unobservable on this legacy path.

Translates the connector-facing AssistantMessage into the real
`assistant_message` envelope via AssistantInjectionMessage so the
frame goes through the same codec as every other send. The smart
constructor stamps a `Date.now()` epoch timestamp — the previous bespoke
frame used `performance.now()` (a monotonic clock offset from an arbitrary
origin), which is not a wall-clock time. A compatible server sends no frame
for insertion success or failure, so this method cannot observe either.

#### Parameters

##### message

`AssistantMessage`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`AcknowledgedAssistantConnector.addAssistantMessage`

***

### addAssistantMessageAcknowledged()

> **addAssistantMessageAcknowledged**(`message`): `Promise`\<`AssistantMessageOutcome`\>

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:133

Insert an assistant message and wait for the correlated
AssistantMessageOutcome from `engine.assistant_message.result`.

Unlike [addAssistantMessage](/reference/react/classes/websocketconnector/#addassistantmessage), this sends the opt-in
`client.assistant_message.acknowledged` envelope. A server that predates
that envelope may reject it with a correlated `engine.error` or stay
silent; those paths reject promptly or at the bounded timeout rather than
being mistaken for successful persistence.

Correlation uses `message.id` as `requestId` and times out after the
connector `timeout` (default 30s).

#### Parameters

##### message

`AssistantMessage`

#### Returns

`Promise`\<`AssistantMessageOutcome`\>

#### Throws

If the WebSocket is disconnected or the session is not yet
  established, or if construction rejects malformed message content.

#### Throws

If `WebSocket.send` fails while enqueueing the frame; the pending
  correlator is cleared before the returned promise rejects.

#### Throws

If the engine reports a correlated
  `engine.error`.

#### Throws

If the socket closes before the result arrives, or if the
  acknowledgement times out.

#### Implementation of

`AcknowledgedAssistantConnector.addAssistantMessageAcknowledged`

***

### connect()

> **connect**(`sessionId`): `Promise`\<`void`\>

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:106

Establishes WebSocket connection.
Throws on failure — ConnectionManager will handle retries.

Idempotent only for the SAME `sessionId`: a second call for that session
while a socket is already open or connecting is a no-op (open) or joins
the in-flight attempt (connecting) instead of constructing another
`WebSocket`, since the underlying socket assignment below does not
itself guard against overwriting a live one. A call with a DIFFERENT
`sessionId` is never idempotent — it always reassigns `#sessionId` and
dials a fresh socket, even over one that is open or connecting, because
silently keeping the old session would leave `#sessionId` (embedded in
outbound envelopes such as `assistant_message`) pointing at a session
this call was explicitly asked to move away from.

#### Parameters

##### sessionId

`SessionId`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`AcknowledgedAssistantConnector.connect`

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:110

Closes the WebSocket connection and rejects all pending requests.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`AcknowledgedAssistantConnector.disconnect`

***

### getHistory()

> **getHistory**(`sessionId`): `Promise`\<readonly `SessionHistoryEntry`[]\>

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:168

Sends a `client.history.get` request and waits for the correlated
`engine.history.response`. Correlation goes through `#historyCorrelator`
(typed for `SessionHistoryEntry[]`) so the response can't be misrouted
to `process()`'s `MaelstromResponse` correlator even if the freshly
generated request id happens to collide with an in-flight chart request.

#### Parameters

##### sessionId

`SessionId`

#### Returns

`Promise`\<readonly `SessionHistoryEntry`[]\>

#### Implementation of

`AcknowledgedAssistantConnector.getHistory`

***

### process()

> **process**(`message`): `Promise`\<`MaelstromResponse`\>

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:141

Sends a chart_request envelope and waits for the correlated response.

#### Parameters

##### message

`ChartRequestMessage`

#### Returns

`Promise`\<`MaelstromResponse`\>

#### Implementation of

`AcknowledgedAssistantConnector.process`

***

### setDiagnosticContent()

> **setDiagnosticContent**(`enabled`): `void`

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:89

Enables server content forwarding only for an explicit local capture.

#### Parameters

##### enabled

`boolean`

#### Returns

`void`

***

### subscribe()

> **subscribe**(`handler`): `Unsubscribe`

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:137

Subscribe to transport-level events (disconnected, error).

#### Parameters

##### handler

(`event`) => `void`

#### Returns

`Unsubscribe`

#### Implementation of

`AcknowledgedAssistantConnector.subscribe`

***

### subscribeDiagnostics()

> **subscribeDiagnostics**(`listener`): () => `void`

Defined in: packages/client/dist/lib/connection-manager/connectors/web-socket-connector.d.ts:87

Observes optional server traces and enables forwarding only while subscribed.

#### Parameters

##### listener

(`event`) => `void`

#### Returns

() => `void`
