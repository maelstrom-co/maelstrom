---
editUrl: false
next: false
prev: false
title: "OpenAITokenGrant"
---

Defined in: packages/realtime-protocol/dist/lib/openai-token.d.ts:35

The ephemeral OpenAI credential the browser uses to open the realtime
session directly. `value` is provider-opaque (an OpenAI `ek-…` client
secret) — the adapter, not this schema, interprets it.

## Extends

- `TokenGrant`

## Properties

### expiresAt

> `readonly` **expiresAt**: `UnixSeconds`

Defined in: packages/realtime-protocol/dist/lib/token-grant.d.ts:15

Absolute Unix-epoch second at which the credential expires.

#### Inherited from

`TokenGrant.expiresAt`

***

### model

> `readonly` **model**: `string`

Defined in: packages/realtime-protocol/dist/lib/openai-token.d.ts:42

The model the credential was minted for. Informational for the client —
the credential itself is already scoped to this model upstream.

***

### provider

> `readonly` **provider**: `"openai"`

Defined in: packages/realtime-protocol/dist/lib/openai-token.d.ts:36

***

### value

> `readonly` **value**: `string`

Defined in: packages/realtime-protocol/dist/lib/openai-token.d.ts:37
