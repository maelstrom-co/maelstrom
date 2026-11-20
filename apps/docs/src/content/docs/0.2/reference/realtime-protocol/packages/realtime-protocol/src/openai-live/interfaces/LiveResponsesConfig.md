---
editUrl: false
next: false
prev: false
title: "LiveResponsesConfig"
---

Defined in: packages/realtime-protocol/src/openai-live.ts:27

Supported managed backend configuration, independent of conversation instructions.

## Properties

### instructions?

> `readonly` `optional` **instructions?**: `string`

Defined in: packages/realtime-protocol/src/openai-live.ts:31

Backend-only instructions.

***

### max\_output\_tokens?

> `readonly` `optional` **max\_output\_tokens?**: `number`

Defined in: packages/realtime-protocol/src/openai-live.ts:45

Backend token limit, at least sixteen.

***

### model

> `readonly` **model**: `string`

Defined in: packages/realtime-protocol/src/openai-live.ts:29

Required backend model with project access.

***

### parallel\_tool\_calls?

> `readonly` `optional` **parallel\_tool\_calls?**: `boolean`

Defined in: packages/realtime-protocol/src/openai-live.ts:43

Allow parallel backend calls; application execution remains host-owned.

***

### tool\_choice?

> `readonly` `optional` **tool\_choice?**: `"auto"` \| `"required"` \| `"none"`

Defined in: packages/realtime-protocol/src/openai-live.ts:41

Backend tool selection policy.

***

### tools?

> `readonly` `optional` **tools?**: readonly ([`LiveFunctionTool`](/reference/realtime-protocol/packages/realtime-protocol/src/openai-live/interfaces/livefunctiontool/) \| \{ `type`: `"web_search"`; \})[]

Defined in: packages/realtime-protocol/src/openai-live.ts:33

Application functions or hosted web search.
