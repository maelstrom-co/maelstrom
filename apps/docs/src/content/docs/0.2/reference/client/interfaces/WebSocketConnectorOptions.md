---
editUrl: false
next: false
prev: false
title: "WebSocketConnectorOptions"
---

Defined in: packages/client/src/lib/connection-manager/connectors/web-socket-connector.ts:50

Configuration options for WebSocket connector.

## Properties

### connectTimeoutMs?

> `optional` **connectTimeoutMs?**: `number`

Defined in: packages/client/src/lib/connection-manager/connectors/web-socket-connector.ts:56

Connection establishment timeout in milliseconds (default: 10000)

***

### heartbeatIntervalMs?

> `optional` **heartbeatIntervalMs?**: `number`

Defined in: packages/client/src/lib/connection-manager/connectors/web-socket-connector.ts:106

If set, sends `{"type":"heartbeat.ping"}` on this interval while
connected. Needed by transports that treat an open-but-silent connection
as dead. Under Durable Objects the runtime answers these pings itself via
`setWebSocketAutoResponse` without waking the object, so the interval
costs nothing server-side and serves purely as client-side liveness
detection. Omitted: no heartbeat is sent (local dev default). The
connector consumes the server's `heartbeat.pong` replies itself — they
never reach subscribers or the envelope decode path.

Must be a finite positive number when provided — the constructor throws
otherwise. `0`, a negative value, and `NaN` would otherwise reach
`setInterval` as an effectively-immediate timer (flooding pings at the
server), and `Infinity` would silently never fire.

***

### onFrame?

> `optional` **onFrame?**: (`raw`, `send`, `sessionId`, `isCurrentConnection?`) => `boolean`

Defined in: packages/client/src/lib/connection-manager/connectors/web-socket-connector.ts:85

Invoked for each inbound text frame before envelope decoding. Return
`true` to consume the frame — it will not reach subscribers or the
decode path. Return `false` to let it through unchanged.

The counterpart to `onOpen`: together they let a consumer own a
transport-level sub-protocol (a host-specific handshake and its
server-initiated follow-ups) without this package knowing anything
about it. `send` bypasses envelope encoding — callers must produce
valid JSON text.

Heartbeat pongs are consumed by the connector before this runs, so a
consumer cannot accidentally break liveness detection.

`isCurrentConnection` reports whether the receiving socket is still
current at delivery. Late frames can still be handled and replied to on
their originating socket; consumers updating current connection state
should ignore frames where this value is `false`.

#### Parameters

##### raw

`string`

##### send

(`data`) => `void`

##### sessionId

[`SessionId`](/reference/client/type-aliases/sessionid/)

##### isCurrentConnection?

`boolean`

#### Returns

`boolean`

***

### onOpen?

> `optional` **onOpen?**: (`send`, `sessionId`) => `void`

Defined in: packages/client/src/lib/connection-manager/connectors/web-socket-connector.ts:65

Invoked once, synchronously, right after the socket opens and before
connect() resolves. Lets a consumer send a transport-level frame ahead
of the first protocol message (e.g. a host-specific auth handshake).
`send` bypasses envelope encoding — callers must produce valid JSON
text. Omitted entirely for consumers that don't need one; the connector
behaves exactly as it does today with no `onOpen` configured.

#### Parameters

##### send

(`data`) => `void`

##### sessionId

[`SessionId`](/reference/client/type-aliases/sessionid/)

#### Returns

`void`

***

### timeout?

> `optional` **timeout?**: `number`

Defined in: packages/client/src/lib/connection-manager/connectors/web-socket-connector.ts:54

Request timeout in milliseconds (default: 30000)

***

### url

> **url**: `string`

Defined in: packages/client/src/lib/connection-manager/connectors/web-socket-connector.ts:52

WebSocket URL (ws:// or wss://)
