---
editUrl: false
next: false
prev: false
title: "SetLayoutCommand"
---

Defined in: packages/client/src/lib/command-processor/command.types.ts:9

Applies a layout and reconciles retained Instances before the next command.

## Properties

### kind

> **kind**: `"set_layout"`

Defined in: packages/client/src/lib/command-processor/command.types.ts:11

Dispatches to layout reconciliation.

***

### layout

> **layout**: `GridLayout` \| `TilingLayout`

Defined in: packages/client/src/lib/command-processor/command.types.ts:15

Grid layouts reuse retained metadata; tiling layouts replace it from `instances`.

***

### requestId?

> `optional` **requestId?**: [`MessageId`](/reference/client/type-aliases/messageid/)

Defined in: packages/client/src/lib/command-processor/command.types.ts:13

Diagnostic correlation; never changes command execution.
