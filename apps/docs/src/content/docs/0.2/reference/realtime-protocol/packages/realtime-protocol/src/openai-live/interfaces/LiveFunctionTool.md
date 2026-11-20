---
editUrl: false
next: false
prev: false
title: "LiveFunctionTool"
---

Defined in: packages/realtime-protocol/src/openai-live.ts:13

A managed Responses function definition.

## Properties

### description?

> `readonly` `optional` **description?**: `string`

Defined in: packages/realtime-protocol/src/openai-live.ts:19

Function purpose.

***

### name

> `readonly` **name**: `string`

Defined in: packages/realtime-protocol/src/openai-live.ts:17

Backend function name.

***

### parameters

> `readonly` **parameters**: `object`

Defined in: packages/realtime-protocol/src/openai-live.ts:21

JSON Schema for arguments.

#### Index Signature

\[`key`: `string`\]: [`LiveJson`](/reference/realtime-protocol/packages/realtime-protocol/src/openai-live/type-aliases/livejson/)

***

### strict?

> `readonly` `optional` **strict?**: `boolean`

Defined in: packages/realtime-protocol/src/openai-live.ts:23

Require schema-conforming arguments.

***

### type

> `readonly` **type**: `"function"`

Defined in: packages/realtime-protocol/src/openai-live.ts:15

Tool discriminator.
