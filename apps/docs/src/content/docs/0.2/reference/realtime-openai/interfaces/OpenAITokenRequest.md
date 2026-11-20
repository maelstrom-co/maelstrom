---
editUrl: false
next: false
prev: false
title: "OpenAITokenRequest"
---

Defined in: packages/realtime-protocol/dist/lib/openai-token.d.ts:9

What the browser sends to the OpenAI token-mint endpoint to bootstrap a
client-direct realtime session. Carries no secret — the mint endpoint holds
the provider key and returns an ephemeral credential.

## Properties

### model?

> `readonly` `optional` **model?**: `string`

Defined in: packages/realtime-protocol/dist/lib/openai-token.d.ts:14

Optional model override; the server picks a default when omitted.

***

### provider

> `readonly` **provider**: `"openai"`

Defined in: packages/realtime-protocol/dist/lib/openai-token.d.ts:10

***

### sessionId

> `readonly` **sessionId**: `SessionId`

Defined in: packages/realtime-protocol/dist/lib/openai-token.d.ts:12

Binds the minted session to the Maelstrom session for the sidechannel.
