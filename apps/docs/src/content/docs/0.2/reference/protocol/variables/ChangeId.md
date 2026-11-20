---
editUrl: false
next: false
prev: false
title: "ChangeId"
---

> **ChangeId**: (`value`) => [`ChangeId`](/reference/protocol/type-aliases/changeid/)

Defined in: packages/protocol/src/lib/agent-ids.ts:84

Brands an existing string as a [ChangeId](/reference/protocol/variables/changeid/). Smart constructor: the
identifier names both the type and this factory. Change ids are minted by
the host that emits the UI change, so this only brands and never generates.

## Parameters

### value

`string`

## Returns

[`ChangeId`](/reference/protocol/type-aliases/changeid/)

## Throws

Error when `value` is empty or whitespace-only.

## Example

```ts
const changeId = ChangeId(crypto.randomUUID());
```
