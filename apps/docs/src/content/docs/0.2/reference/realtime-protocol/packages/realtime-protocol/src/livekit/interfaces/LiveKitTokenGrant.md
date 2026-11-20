---
editUrl: false
next: false
prev: false
title: "LiveKitTokenGrant"
---

Defined in: packages/realtime-protocol/src/lib/livekit-token.ts:18

A LiveKit access token and room URL for a single room.

The server sibling (`@maelstrom-co/realtime-livekit-server`) mints this;
the browser adapter consumes `token` and `url` to join the room. The grant's
`expiresAt` describes validity for each initial or fresh room connection,
including an explicit `connect()` after `disconnect()`. Expiration does not
affect an active room or SDK-managed reconnects for an already connected
participant because LiveKit pushes refreshed tokens to connected clients.
The browser adapter does not read `expiresAt` or schedule proactive renewal.

## Extends

- [`TokenGrant`](/reference/realtime-protocol/packages/realtime-protocol/src/interfaces/tokengrant/)

## Properties

### expiresAt

> `readonly` **expiresAt**: [`UnixSeconds`](/reference/realtime-protocol/packages/realtime-protocol/src/type-aliases/unixseconds/)

Defined in: packages/realtime-protocol/src/lib/livekit-token.ts:35

Absolute Unix-epoch second after which this JWT cannot authenticate an
initial or fresh room connection. Token expiry is checked for each such
connection, including an explicit `connect()` after `disconnect()`. It does
not impact SDK-managed reconnects for an already connected participant:
LiveKit pushes refreshed tokens to connected clients, and the SDK uses the
refreshed token for managed reconnects. Expiry alone does not disconnect an
active participant or end the room.

The browser adapter does not read this value, schedule an automatic
refresh, or impose a maximum active-room duration. Each fresh `connect()`
invokes `mintToken`. Production hosts must enforce session-duration and
cleanup policy independently of this timestamp.

#### Overrides

[`TokenGrant`](/reference/realtime-protocol/packages/realtime-protocol/src/interfaces/tokengrant/).[`expiresAt`](/reference/realtime-protocol/packages/realtime-protocol/src/interfaces/tokengrant/#expiresat)

***

### token

> `readonly` **token**: `string`

Defined in: packages/realtime-protocol/src/lib/livekit-token.ts:19

***

### url

> `readonly` **url**: `string`

Defined in: packages/realtime-protocol/src/lib/livekit-token.ts:20
