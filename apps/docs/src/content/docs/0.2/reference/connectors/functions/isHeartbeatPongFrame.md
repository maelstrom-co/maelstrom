---
editUrl: false
next: false
prev: false
title: "isHeartbeatPongFrame"
---

> **isHeartbeatPongFrame**(`value`): `boolean`

Defined in: packages/connectors/src/heartbeat-frame.ts:91

True if `value` is a parsed `heartbeat.pong` frame. See [isHeartbeatPingFrame](/reference/connectors/functions/isheartbeatpingframe/) for the parsed-input requirement.

A pong frame must never be routed through `decodeServerEnvelope` — it
carries no `id`/`sessionId`/protocol fields, so the envelope codec would
reject it as undecodable. Callers must intercept it with this guard
before it reaches the protocol decode path.

## Parameters

### value

`unknown`

## Returns

`boolean`

## Example

```ts
const parsed: unknown = JSON.parse(rawMessage);
if (isHeartbeatPongFrame(parsed)) {
  return; // consumed transport-side; never decoded as a protocol envelope
}
const envelope = decodeServerEnvelope(rawMessage);
```
