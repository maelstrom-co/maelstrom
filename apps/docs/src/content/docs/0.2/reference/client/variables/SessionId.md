---
editUrl: false
next: false
prev: false
title: "SessionId"
---

> **SessionId**: (`value?`) => [`SessionId`](/reference/client/type-aliases/sessionid/)

Defined in: packages/protocol/dist/lib/session.d.ts:7

Creates or brands a SessionId. Smart constructor — the identifier
`SessionId` refers to both the type (for type annotations) and the factory
(for runtime creation), exploiting TypeScript's separate type/value namespaces.

- Called with no arguments: generates a new unique session ID with a
  `session-` prefix for easy log grepping.
- Called with an existing string: brands it as a SessionId without changing
  its value. Use this when the developer brings their own ID (DB row ID,
  user ID, persisted localStorage value, etc.) or when rehydrating from
  serialized data.

## Parameters

### value?

`string`

## Returns

[`SessionId`](/reference/client/type-aliases/sessionid/)

## Example

```ts
const fresh = SessionId();               // 'session-<nanoid>'
const fromDb = SessionId(row.sessionId); // brands an existing id
```
