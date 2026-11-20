---
editUrl: false
next: false
prev: false
title: "OpenAITokenGrant"
---

Defined in: packages/realtime-protocol/src/lib/openai-token.ts:40

The ephemeral OpenAI credential the browser uses to open the realtime
session directly. `value` is provider-opaque (an OpenAI `ek-…` client
secret) — the adapter, not this schema, interprets it.

## Extends

- [`TokenGrant`](/reference/realtime-protocol/packages/realtime-protocol/src/interfaces/tokengrant/)

## Properties

### expiresAt

> `readonly` **expiresAt**: [`UnixSeconds`](/reference/realtime-protocol/packages/realtime-protocol/src/type-aliases/unixseconds/)

Defined in: packages/realtime-protocol/src/lib/token-grant.ts:16

Absolute Unix-epoch second at which the credential expires.

#### Inherited from

[`TokenGrant`](/reference/realtime-protocol/packages/realtime-protocol/src/interfaces/tokengrant/).[`expiresAt`](/reference/realtime-protocol/packages/realtime-protocol/src/interfaces/tokengrant/#expiresat)

***

### model

> `readonly` **model**: `string`

Defined in: packages/realtime-protocol/src/lib/openai-token.ts:47

The model the credential was minted for. Informational for the client —
the credential itself is already scoped to this model upstream.

***

### provider

> `readonly` **provider**: `"openai"`

Defined in: packages/realtime-protocol/src/lib/openai-token.ts:41

***

### value

> `readonly` **value**: `string`

Defined in: packages/realtime-protocol/src/lib/openai-token.ts:42
