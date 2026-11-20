---
editUrl: false
next: false
prev: false
title: "HEARTBEAT_PING_FRAME"
---

> `const` **HEARTBEAT\_PING\_FRAME**: "\{\"type\":\"heartbeat.ping\"\}" = "\{\"type\":\"heartbeat.ping\"\}"

Defined in: packages/connectors/dist/heartbeat-frame.d.ts:20

Wire shape of the WebSocket heartbeat mechanism configured by
`@maelstrom-co/client`'s `WebSocketConnectorOptions.heartbeatIntervalMs`
option. These frames are transport-level only: they are deliberately
**not** part of the `@maelstrom-co/protocol` envelope union, so a host
answering the heartbeat (e.g. a hosted deployment's server) must match
this shape exactly rather than reimplementing it from memory or trying to
route it through the protocol codec.

## Example

```ts
// Server-side: reply to every ping with a pong, verbatim.
ws.addEventListener('message', (event) => {
  if (event.data === HEARTBEAT_PING_FRAME) {
    ws.send(HEARTBEAT_PONG_FRAME);
  }
});
```
