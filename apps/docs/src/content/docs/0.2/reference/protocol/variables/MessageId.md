---
editUrl: false
next: false
prev: false
title: "MessageId"
---

> **MessageId**: (`value?`) => [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/message.ts:18

Creates or brands a MessageId. Smart constructor — same pattern as SessionId.

- Called with no arguments: generates a new unique Nano ID (no prefix).
- Called with an existing string: brands it as a MessageId without
  changing its value. Use this when rehydrating from serialized data.

## Parameters

### value?

`string`

## Returns

[`MessageId`](/reference/protocol/type-aliases/messageid/)

## Example

```ts
const fresh = MessageId();          // new Nano ID
const echoed = MessageId(input.id); // brands an existing id
```
