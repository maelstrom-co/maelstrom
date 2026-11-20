---
editUrl: false
next: false
prev: false
title: "NeedsClarification"
---

Defined in: packages/protocol/src/lib/needs-clarification.ts:15

A Planner result that asks the user a question instead of changing the
screen: it carries no layout and no execution plan.

Only valid when the chart request set `skipReply: true`. A caller that
leaves `skipReply` unset expects a reply-bearing response, so the Engine
rejects this result on that path. Engine validation accepts it when the
flag is set, but `Engine.handle` currently refuses it even then with
`Err(ValidationError)` on field `skipReply`.

## Properties

### options?

> `readonly` `optional` **options?**: readonly `string`[]

Defined in: packages/protocol/src/lib/needs-clarification.ts:21

Suggested answers the caller may offer the user. Each one is non-blank.

***

### question

> `readonly` **question**: `string`

Defined in: packages/protocol/src/lib/needs-clarification.ts:19

The question the Planner needs answered before it can proceed. Never blank.

***

### type

> `readonly` **type**: `"needs_clarification"`

Defined in: packages/protocol/src/lib/needs-clarification.ts:17

Discriminant that tells this result apart from a layout candidate.
