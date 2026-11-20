---
editUrl: false
next: false
prev: false
title: "LiveSessionConfig"
---

Defined in: packages/realtime-protocol/src/openai-live.ts:49

Startup configuration for WebRTC with managed Responses; no credential fields.

## Properties

### audio?

> `readonly` `optional` **audio?**: `object`

Defined in: packages/realtime-protocol/src/openai-live.ts:59

WebRTC negotiates format; only voice selection is accepted here.

#### output

> `readonly` **output**: `object`

Generated speech settings.

##### output.voice

> `readonly` **voice**: `string`

Voice selected at startup.

***

### delegation

> `readonly` **delegation**: `object`

Defined in: packages/realtime-protocol/src/openai-live.ts:67

Managed backend configuration.

#### responses

> `readonly` **responses**: [`LiveResponsesConfig`](/reference/realtime-protocol/packages/realtime-protocol/src/openai-live/interfaces/liveresponsesconfig/)

Backend model, prompt and tools.

#### type

> `readonly` **type**: `"responses"`

Managed backend ownership.

***

### input?

> `readonly` `optional` **input?**: readonly [`LiveInputMessage`](/reference/realtime-protocol/packages/realtime-protocol/src/openai-live/type-aliases/liveinputmessage/)[]

Defined in: packages/realtime-protocol/src/openai-live.ts:51

Prior text context available at startup. This implementation bounds combined text to 8192 UTF-8 bytes, conservatively below the provider token limit.

***

### instructions?

> `readonly` `optional` **instructions?**: `string`

Defined in: packages/realtime-protocol/src/openai-live.ts:55

Conversation-only instructions.

***

### model

> `readonly` **model**: `string`

Defined in: packages/realtime-protocol/src/openai-live.ts:53

Voice model with project access.

***

### store?

> `readonly` `optional` **store?**: `boolean`

Defined in: packages/realtime-protocol/src/openai-live.ts:57

Recording is disabled unless explicitly enabled by the trusted host.
