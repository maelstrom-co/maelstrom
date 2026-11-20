---
editUrl: false
next: false
prev: false
title: "RunId"
---

> **RunId**: (`value`) => [`RunId`](/reference/protocol/type-aliases/runid/)

Defined in: packages/protocol/src/lib/agent-ids.ts:10

Brands an existing string as a [RunId](/reference/protocol/variables/runid/). Smart constructor: the
identifier names both the type and this factory. Run ids are minted by the
host that runs the loop, so this only brands and never generates.

## Parameters

### value

`string`

## Returns

[`RunId`](/reference/protocol/type-aliases/runid/)

## Throws

Error when `value` is empty or whitespace-only.

## Example

```ts
const runId = RunId(crypto.randomUUID());
```
