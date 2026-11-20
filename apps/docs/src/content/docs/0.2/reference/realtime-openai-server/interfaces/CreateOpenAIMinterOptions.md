---
editUrl: false
next: false
prev: false
title: "CreateOpenAIMinterOptions"
---

Defined in: packages/realtime-openai-server/src/lib/openai-mint.ts:25

Trusted server-held configuration for [createOpenAIMinter](/reference/realtime-openai-server/functions/createopenaiminter/).

These inputs stay on the mint host: the browser never supplies or overrides
`apiKey` or `voice`. That boundary matters because the minter authenticates
upstream with the long-lived key and pins Realtime output voice under
`session.audio.output.voice`. Browser request data may select only
schema-approved handshake fields (for example an optional model once the
host has authorized it) and cannot widen this trusted configuration.

## Properties

### apiKey

> `readonly` **apiKey**: `string`

Defined in: packages/realtime-openai-server/src/lib/openai-mint.ts:27

Server-held OpenAI API key. Never forwarded to the caller.

***

### fetch?

> `readonly` `optional` **fetch?**: `MintFetch`

Defined in: packages/realtime-openai-server/src/lib/openai-mint.ts:40

Fetch implementation used for the upstream call to OpenAI. Defaults to
the global `fetch`; inject a fake in tests to avoid a real network call.

***

### model

> `readonly` **model**: `string`

Defined in: packages/realtime-openai-server/src/lib/openai-mint.ts:29

Default realtime model; a validated request model overrides this value.

***

### voice?

> `readonly` `optional` **voice?**: `OpenAIBuiltInVoice`

Defined in: packages/realtime-openai-server/src/lib/openai-mint.ts:35

Trusted server-side Realtime output voice. When set, nested under
`session.audio.output.voice` on the client-secret request. Browser input
cannot override this value.
