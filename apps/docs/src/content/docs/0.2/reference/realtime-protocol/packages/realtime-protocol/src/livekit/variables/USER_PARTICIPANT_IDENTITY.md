---
editUrl: false
next: false
prev: false
title: "USER_PARTICIPANT_IDENTITY"
---

> `const` **USER\_PARTICIPANT\_IDENTITY**: `"user"` = `'user'`

Defined in: packages/realtime-protocol/src/lib/livekit-wire.ts:16

Identity the browser client connects to the room with, and the identity the
worker waits for on join and filters incoming tracks against. A room-wide
constant (not per-session) because the spike supports exactly one human
participant per room.
