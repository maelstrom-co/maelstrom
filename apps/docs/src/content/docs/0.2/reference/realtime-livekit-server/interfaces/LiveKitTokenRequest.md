---
editUrl: false
next: false
prev: false
title: "LiveKitTokenRequest"
---

Defined in: packages/realtime-livekit-server/src/lib/livekit-mint.ts:17

What a caller passes [mintLiveKitToken](/reference/realtime-livekit-server/functions/mintlivekittoken/) to scope a token to one room.
The package validates this request shape, while application transport retains
authentication, authorization, CSRF, origin, rate-limit, and trusted-scope
responsibilities.

## Properties

### identity?

> `readonly` `optional` **identity?**: `string`

Defined in: packages/realtime-livekit-server/src/lib/livekit-mint.ts:21

Participant identity, defaulting to `"user"` when omitted.

***

### roomName

> `readonly` **roomName**: `string`

Defined in: packages/realtime-livekit-server/src/lib/livekit-mint.ts:19

Caller-provided room scope; validation trims surrounding whitespace before token scoping.
