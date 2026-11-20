---
editUrl: false
next: false
prev: false
title: "DuplicateTilingLeaf"
---

Defined in: packages/protocol/src/lib/response.ts:160

An occurrence of an Instance already used as a tree leaf earlier in
preorder.

## Properties

### atTokenIndex

> `readonly` **atTokenIndex**: `number`

Defined in: packages/protocol/src/lib/response.ts:164

Index of the repeat itself, never of the earlier legitimate occurrence.

***

### instanceId

> `readonly` **instanceId**: [`InstanceId`](/reference/protocol/type-aliases/instanceid/)

Defined in: packages/protocol/src/lib/response.ts:162

The Instance the tree names more than once.
