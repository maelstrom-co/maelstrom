---
editUrl: false
next: false
prev: false
title: "InstanceId"
---

> **InstanceId**: (`value`) => [`InstanceId`](/reference/protocol/type-aliases/instanceid/)

Defined in: packages/protocol/src/lib/instance.ts:8

Brands a string as an InstanceId without changing its value.

Unlike `SessionId` and `MessageId`, this factory has no auto-gen path:
an InstanceId always originates from an external source (LLM execution
plan, persisted layout, wire frame) where the ID is already chosen.
Generating one client-side would mean inventing an identity for an entity
Maelstrom didn't create, which is never what callers want.

## Parameters

### value

`string`

## Returns

[`InstanceId`](/reference/protocol/type-aliases/instanceid/)

## Example

```ts
const id = InstanceId('calendar-main');
const byId = new Map<InstanceId, Vessel>();
```
