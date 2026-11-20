---
editUrl: false
next: false
prev: false
title: "RealtimeSessionInit"
---

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:46

What a session the extension builds is for: the Maelstrom session and the
voice provider. Passed to [MaelstromRealtimeBaseOptions.createAdapter](/reference/react-realtime/interfaces/maelstromrealtimebaseoptions/#createadapter)
and to the `opening` option.

## Extended by

- [`RealtimeSessionContext`](/reference/react-realtime/interfaces/realtimesessioncontext/)

## Type Parameters

### Provider

`Provider` = `undefined`

## Properties

### provider

> `readonly` **provider**: `Provider`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:57

Voice provider this session is built for: the initial provider, or the
one chosen through [UseVoiceResult.switchProvider](/reference/react-realtime/interfaces/usevoiceresult/#switchprovider). `undefined`
when the extension declares no provider.

***

### sessionId

> `readonly` **sessionId**: `SessionId`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:51

Maelstrom session identifier, used to scope provider-side resources. It
stays the same across provider switches and remounts.
