---
editUrl: false
next: false
prev: false
title: "getVisibleInstanceIds"
---

> **getVisibleInstanceIds**(`layout`): `ReadonlySet`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/)\>

Defined in: packages/protocol/src/lib/response.ts:497

Projects the Instance references eligible for rendering from a layout.

This projection has no retained Instance store to resolve against. Callers
that need the Instances actually rendered must intersect the result with
their retained IDs.

Grid visibility is every position. For tiling layouts, tokens are consumed
for the first preorder root: a split token requires as many children as its
weights declare, `null` fills a child slot without adding an Instance, and
input may end with child slots still missing. Encountered Instance leaves
remain visible in a partial or otherwise malformed root. Duplicate leaves
are returned once in first encounter order, while tokens trailing the
parsed root are ignored.

Tiling projection is iterative and stack-safe for deeply nested input. This
guarantee applies only to visibility projection, not to downstream parsers
or renderers. A null layout has no visible Instances.

## Parameters

### layout

[`GridLayout`](/reference/protocol/interfaces/gridlayout/) \| [`TilingLayout`](/reference/protocol/interfaces/tilinglayout/) \| `null`

## Returns

`ReadonlySet`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/)\>
