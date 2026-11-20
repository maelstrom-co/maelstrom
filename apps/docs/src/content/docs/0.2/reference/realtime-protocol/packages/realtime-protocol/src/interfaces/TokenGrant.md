---
editUrl: false
next: false
prev: false
title: "TokenGrant"
---

Defined in: packages/realtime-protocol/src/lib/token-grant.ts:14

Open base contract for an ephemeral, client-direct realtime credential.

Deliberately minimal — it carries only `expiresAt`, the one field every
transport shares so a client can refresh a grant proactively before it
lapses. Each provider adapter declares its own grant by
extending this with the provider-opaque credential fields it needs (an
OpenAI client secret, a LiveKit room JWT + URL, …). Keeping the union open
means a third-party adapter can ship a new grant shape without editing any
shared package.

## Extended by

- [`OpenAITokenGrant`](/reference/realtime-protocol/packages/realtime-protocol/src/openai/interfaces/openaitokengrant/)
- [`LiveKitTokenGrant`](/reference/realtime-protocol/packages/realtime-protocol/src/livekit/interfaces/livekittokengrant/)

## Properties

### expiresAt

> `readonly` **expiresAt**: [`UnixSeconds`](/reference/realtime-protocol/packages/realtime-protocol/src/type-aliases/unixseconds/)

Defined in: packages/realtime-protocol/src/lib/token-grant.ts:16

Absolute Unix-epoch second at which the credential expires.
