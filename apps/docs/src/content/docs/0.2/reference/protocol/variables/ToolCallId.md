---
editUrl: false
next: false
prev: false
title: "ToolCallId"
---

> **ToolCallId**: (`value`) => [`ToolCallId`](/reference/protocol/type-aliases/toolcallid/)

Defined in: packages/protocol/src/lib/tool-call-id.ts:11

Creates or brands a ToolCallId. Smart constructor — the identifier
`ToolCallId` refers to both the type (for type annotations) and the
factory (for runtime creation), exploiting TypeScript's separate
type/value namespaces.

Unlike [SessionId](/reference/protocol/type-aliases/sessionid/), a ToolCallId always comes from the provider (it
correlates an in-flight tool call with its result), so this constructor
never generates one — it only brands an existing string.

## Parameters

### value

`string`

## Returns

[`ToolCallId`](/reference/protocol/type-aliases/toolcallid/)

## Example

```ts
const callId = ToolCallId(event.call_id); // brands a provider-assigned id
```
