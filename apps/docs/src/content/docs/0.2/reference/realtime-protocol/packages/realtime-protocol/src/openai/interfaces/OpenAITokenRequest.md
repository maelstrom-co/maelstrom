---
editUrl: false
next: false
prev: false
title: "OpenAITokenRequest"
---

Defined in: packages/realtime-protocol/src/lib/openai-token.ts:12

What the browser sends to the OpenAI token-mint endpoint to bootstrap a
client-direct realtime session. Carries no secret — the mint endpoint holds
the provider key and returns an ephemeral credential.

## Properties

### model?

> `readonly` `optional` **model?**: `string`

Defined in: packages/realtime-protocol/src/lib/openai-token.ts:17

Optional model override; the server picks a default when omitted.

***

### provider

> `readonly` **provider**: `"openai"`

Defined in: packages/realtime-protocol/src/lib/openai-token.ts:13

***

### sessionId

> `readonly` **sessionId**: `SessionId`

Defined in: packages/realtime-protocol/src/lib/openai-token.ts:15

Binds the minted session to the Maelstrom session for the sidechannel.
