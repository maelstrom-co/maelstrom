---
editUrl: false
next: false
prev: false
title: "RealtimeSessionContext"
---

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:68

Context passed to [MaelstromRealtimeBaseOptions.onSession](/reference/react-realtime/interfaces/maelstromrealtimebaseoptions/#onsession) for one
built session.

## Extends

- [`RealtimeSessionInit`](/reference/react-realtime/interfaces/realtimesessioninit/)\<`Provider`\>

## Type Parameters

### Provider

`Provider` = `undefined`

## Properties

### adapter

> `readonly` **adapter**: `RealtimeProviderAdapter`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:83

The adapter [MaelstromRealtimeBaseOptions.createAdapter](/reference/react-realtime/interfaces/maelstromrealtimebaseoptions/#createadapter) returned
for this session, for provider-specific calls the session does not
expose.

***

### instanceId

> `readonly` **instanceId**: `string`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:77

Random identifier of this one built session. Unlike `sessionId`, it
changes on every provider switch and on every rebuild after the last
consumer unmounts, so diagnostics can tell provider instances apart.

***

### orchestrator

> `readonly` **orchestrator**: `Orchestrator`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:71

Orchestrator whose shared session this is.

***

### provider

> `readonly` **provider**: `Provider`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:57

Voice provider this session is built for: the initial provider, or the
one chosen through [UseVoiceResult.switchProvider](/reference/react-realtime/interfaces/usevoiceresult/#switchprovider). `undefined`
when the extension declares no provider.

#### Inherited from

[`RealtimeSessionInit`](/reference/react-realtime/interfaces/realtimesessioninit/).[`provider`](/reference/react-realtime/interfaces/realtimesessioninit/#provider-1)

***

### sessionId

> `readonly` **sessionId**: `SessionId`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:51

Maelstrom session identifier, used to scope provider-side resources. It
stays the same across provider switches and remounts.

#### Inherited from

[`RealtimeSessionInit`](/reference/react-realtime/interfaces/realtimesessioninit/).[`sessionId`](/reference/react-realtime/interfaces/realtimesessioninit/#sessionid)
