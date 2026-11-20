---
editUrl: false
next: false
prev: false
title: "HttpConnector"
---

Defined in: packages/client/src/lib/connection-manager/connectors/http-connector.ts:70

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

- [`EngineConnector`](/reference/client/interfaces/engineconnector/)

## Constructors

### Constructor

> **new HttpConnector**(`options`): `HttpConnector`

Defined in: packages/client/src/lib/connection-manager/connectors/http-connector.ts:81

#### Parameters

##### options

[`HttpConnectorOptions`](/reference/client/interfaces/httpconnectoroptions/)

#### Returns

`HttpConnector`

## Properties

### capabilities

> `readonly` **capabilities**: [`ConnectorCapabilities`](/reference/client/interfaces/connectorcapabilities/)

Defined in: packages/client/src/lib/connection-manager/connectors/http-connector.ts:75

Connector capabilities. Metadata for consumers — the ConnectionManager
does not use these for flow control.

#### Implementation of

[`EngineConnector`](/reference/client/interfaces/engineconnector/).[`capabilities`](/reference/client/interfaces/engineconnector/#capabilities)

## Methods

### addAssistantMessage()

> **addAssistantMessage**(`message`): `Promise`\<`void`\>

Defined in: packages/client/src/lib/connection-manager/connectors/http-connector.ts:116

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

#### Implementation of

[`EngineConnector`](/reference/client/interfaces/engineconnector/).[`addAssistantMessage`](/reference/client/interfaces/engineconnector/#addassistantmessage)

***

### connect()

> **connect**(`_sessionId`): `Promise`\<`void`\>

Defined in: packages/client/src/lib/connection-manager/connectors/http-connector.ts:95

No-op. HTTP is per-request — there is no persistent connection to establish.
Override this to implement a health check if desired.

Note: the sessionId is not stored because HTTP requests carry session context
in the request body. Subclasses that need session correlation should override
this method and store the sessionId.

#### Parameters

##### \_sessionId

[`SessionId`](/reference/client/type-aliases/sessionid/)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`EngineConnector`](/reference/client/interfaces/engineconnector/).[`connect`](/reference/client/interfaces/engineconnector/#connect)

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/client/src/lib/connection-manager/connectors/http-connector.ts:100

No-op. HTTP is stateless — nothing to clean up.

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`EngineConnector`](/reference/client/interfaces/engineconnector/).[`disconnect`](/reference/client/interfaces/engineconnector/#disconnect)

***

### getHistory()

> **getHistory**(`sessionId`): `Promise`\<readonly `SessionHistoryEntry`[]\>

Defined in: packages/client/src/lib/connection-manager/connectors/http-connector.ts:128

Fetch the engine-recorded history for a session via POST `/history`.

POST (not GET) keeps the request body symmetric with `/process` and
`/assistant-message`, lets clients send opaque session ids without URL
encoding concerns, and avoids accidental caching by intermediaries that
cache GET responses.

#### Parameters

##### sessionId

[`SessionId`](/reference/client/type-aliases/sessionid/)

#### Returns

`Promise`\<readonly `SessionHistoryEntry`[]\>

#### Implementation of

[`EngineConnector`](/reference/client/interfaces/engineconnector/).[`getHistory`](/reference/client/interfaces/engineconnector/#gethistory)

***

### process()

> **process**(`message`): `Promise`\<`MaelstromResponse`\>

Defined in: packages/client/src/lib/connection-manager/connectors/http-connector.ts:112

Sends a chart_request envelope to the API endpoint.

#### Parameters

##### message

`ChartRequestMessage`

#### Returns

`Promise`\<`MaelstromResponse`\>

#### Implementation of

[`EngineConnector`](/reference/client/interfaces/engineconnector/).[`process`](/reference/client/interfaces/engineconnector/#process)

***

### subscribe()

> **subscribe**(`_handler`): [`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

Defined in: packages/client/src/lib/connection-manager/connectors/http-connector.ts:105

HTTP never fires transport events. Returns an unsubscribe no-op.

#### Parameters

##### \_handler

(`event`) => `void`

#### Returns

[`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

#### Implementation of

[`EngineConnector`](/reference/client/interfaces/engineconnector/).[`subscribe`](/reference/client/interfaces/engineconnector/#subscribe)
