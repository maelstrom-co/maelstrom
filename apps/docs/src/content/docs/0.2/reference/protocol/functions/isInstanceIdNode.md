---
editUrl: false
next: false
prev: false
title: "isInstanceIdNode"
---

> **isInstanceIdNode**(`node`): `` node is `ID:${string}` ``

Defined in: packages/protocol/src/lib/response.ts:175

True iff the node is a leaf naming an Instance.

Every class of node is recognised by what it is spelled like rather than by
what it is not, so a token belonging to no class stays in no class instead
of falling into whichever one was defined by elimination.
[tilingLeafInstanceId](/reference/protocol/functions/tilingleafinstanceid/) reads the Instance out; this only classifies.

## Parameters

### node

[`TilingNode`](/reference/protocol/type-aliases/tilingnode/)

## Returns

`` node is `ID:${string}` ``
