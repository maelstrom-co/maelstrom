---
editUrl: false
next: false
prev: false
title: "ActionExecution"
---

Defined in: packages/protocol/src/lib/response.ts:22

Parsed instruction to invoke one Action on one Instance.

## Properties

### action

> `readonly` **action**: [`ActionName`](/reference/protocol/type-aliases/actionname/)

Defined in: packages/protocol/src/lib/response.ts:26

Action name valid for the Instance's current Variant.

***

### instanceId

> `readonly` **instanceId**: [`InstanceId`](/reference/protocol/type-aliases/instanceid/)

Defined in: packages/protocol/src/lib/response.ts:24

Target Instance identity.

***

### params?

> `readonly` `optional` **params?**: `Record`\<`string`, `unknown`\>

Defined in: packages/protocol/src/lib/response.ts:28

Parsed Action parameters, omitted for a parameterless invocation.
