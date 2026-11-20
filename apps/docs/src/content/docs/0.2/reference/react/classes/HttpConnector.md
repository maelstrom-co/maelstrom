---
editUrl: false
next: false
prev: false
title: "HttpConnector"
---

Defined in: packages/client/dist/lib/connection-manager/connectors/http-connector.d.ts:43

HTTP connector for stateless API communication.

HTTP connections are per-request, so `connect()` and `disconnect()` are
no-ops, and `subscribe()` never fires any events. Useful for traditional
REST APIs.

## Example

```typescript
import { HttpConnector } from '@maelstrom-co/client';
import { ChartRequestMessage, SessionId } from '@maelstrom-co/protocol';

const connector = new HttpConnector({
  baseUrl: 'https://api.example.com',
  timeout: 30000,
  headers: { 'Authorization': 'Bearer token' },
});

const manager = new ConnectionManager(store, connector);
await manager.connect(SessionId('session-1'));

const envelope = ChartRequestMessage({
  sessionId: SessionId('session-1'),
  request: chartRequestPayload,
});
const response = await connector.process(envelope);
```

## Implements

- `EngineConnector`

## Constructors

### Constructor

> **new HttpConnector**(`options`): `HttpConnector`

Defined in: packages/client/dist/lib/connection-manager/connectors/http-connector.d.ts:46

#### Parameters

##### options

`HttpConnectorOptions`

#### Returns

`HttpConnector`

## Properties

### capabilities

> `readonly` **capabilities**: `ConnectorCapabilities`

Defined in: packages/client/dist/lib/connection-manager/connectors/http-connector.d.ts:45

Connector capabilities. Metadata for consumers — the ConnectionManager
does not use these for flow control.

#### Implementation of

`EngineConnector.capabilities`

## Methods

### addAssistantMessage()

> **addAssistantMessage**(`message`): `Promise`\<`void`\>

Defined in: packages/client/dist/lib/connection-manager/connectors/http-connector.d.ts:68

Add an assistant message to conversation history without LLM processing.
Used for programmatic messages (greetings, notifications).

This legacy capability is fire-and-forget: it resolves after the transport
accepts the send and does not confirm insertion. Use
AcknowledgedAssistantConnector.addAssistantMessageAcknowledged when
dependent side effects require a correlated engine outcome.

#### Parameters

##### message

`AssistantMessage`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`EngineConnector.addAssistantMessage`

***

### connect()

> **connect**(`_sessionId`): `Promise`\<`void`\>

Defined in: packages/client/dist/lib/connection-manager/connectors/http-connector.d.ts:55

No-op. HTTP is per-request — there is no persistent connection to establish.
Override this to implement a health check if desired.

Note: the sessionId is not stored because HTTP requests carry session context
in the request body. Subclasses that need session correlation should override
this method and store the sessionId.

#### Parameters

##### \_sessionId

`SessionId`

#### Returns

`Promise`\<`void`\>

#### Implementation of

`EngineConnector.connect`

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/client/dist/lib/connection-manager/connectors/http-connector.d.ts:59

No-op. HTTP is stateless — nothing to clean up.

#### Returns

`Promise`\<`void`\>

#### Implementation of

`EngineConnector.disconnect`

***

### getHistory()

> **getHistory**(`sessionId`): `Promise`\<readonly `SessionHistoryEntry`[]\>

Defined in: packages/client/dist/lib/connection-manager/connectors/http-connector.d.ts:77

Fetch the engine-recorded history for a session via POST `/history`.

POST (not GET) keeps the request body symmetric with `/process` and
`/assistant-message`, lets clients send opaque session ids without URL
encoding concerns, and avoids accidental caching by intermediaries that
cache GET responses.

#### Parameters

##### sessionId

`SessionId`

#### Returns

`Promise`\<readonly `SessionHistoryEntry`[]\>

#### Implementation of

`EngineConnector.getHistory`

***

### process()

> **process**(`message`): `Promise`\<`MaelstromResponse`\>

Defined in: packages/client/dist/lib/connection-manager/connectors/http-connector.d.ts:67

Sends a chart_request envelope to the API endpoint.

#### Parameters

##### message

`ChartRequestMessage`

#### Returns

`Promise`\<`MaelstromResponse`\>

#### Implementation of

`EngineConnector.process`

***

### subscribe()

> **subscribe**(`_handler`): `Unsubscribe`

Defined in: packages/client/dist/lib/connection-manager/connectors/http-connector.d.ts:63

HTTP never fires transport events. Returns an unsubscribe no-op.

#### Parameters

##### \_handler

(`event`) => `void`

#### Returns

`Unsubscribe`

#### Implementation of

`EngineConnector.subscribe`
