---
editUrl: false
next: false
prev: false
title: "CallId"
---

> **CallId**: (`value`) => [`CallId`](/reference/protocol/type-aliases/callid/)

Defined in: packages/protocol/src/lib/agent-ids.ts:47

Brands an existing string as a [CallId](/reference/protocol/variables/callid/). Smart constructor: the
identifier names both the type and this factory. Call ids are minted by the
agent loop, so this only brands and never generates.

## Parameters

### value

`string`

## Returns

[`CallId`](/reference/protocol/type-aliases/callid/)

## Throws

Error when `value` is empty or whitespace-only.

## Example

```ts
const callId = CallId(crypto.randomUUID());
```
