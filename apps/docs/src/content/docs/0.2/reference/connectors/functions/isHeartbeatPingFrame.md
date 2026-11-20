---
editUrl: false
next: false
prev: false
title: "isHeartbeatPingFrame"
---

> **isHeartbeatPingFrame**(`value`): `boolean`

Defined in: packages/connectors/src/heartbeat-frame.ts:65

True if `value` is a parsed `heartbeat.ping` frame.

`value` must already be the result of `JSON.parse` on the raw wire
string — this does not parse JSON itself, so passing the raw string
(e.g. [HEARTBEAT\_PING\_FRAME](/reference/connectors/variables/heartbeat_ping_frame/)) always returns `false`.

## Parameters

### value

`unknown`

## Returns

`boolean`

## Example

```ts
const parsed: unknown = JSON.parse(rawMessage);
if (isHeartbeatPingFrame(parsed)) {
  respondWithPong();
}
```
