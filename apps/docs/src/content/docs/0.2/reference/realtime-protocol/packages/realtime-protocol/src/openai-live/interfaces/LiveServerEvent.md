---
editUrl: false
next: false
prev: false
title: "LiveServerEvent"
---

Defined in: packages/realtime-protocol/src/openai-live.ts:269

Validated event envelope. Nested Responses fields remain untrusted for the tool integration to validate.

## Indexable

> \[`key`: `string`\]: [`LiveJson`](/reference/realtime-protocol/packages/realtime-protocol/src/openai-live/type-aliases/livejson/)

Native fields preserved without projection.

## Properties

### event\_id

> `readonly` **event\_id**: `string`

Defined in: packages/realtime-protocol/src/openai-live.ts:273

Native event identity.

***

### type

> `readonly` **type**: `string`

Defined in: packages/realtime-protocol/src/openai-live.ts:271

Native event discriminator.
