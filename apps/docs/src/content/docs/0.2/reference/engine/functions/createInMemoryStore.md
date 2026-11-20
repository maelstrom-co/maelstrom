---
editUrl: false
next: false
prev: false
title: "createInMemoryStore"
---

> **createInMemoryStore**\<`TMeta`\>(): [`HistoryStore`](/reference/engine/interfaces/historystore/)\<`TMeta`\>

Defined in: packages/engine/src/lib/history/in-memory-store.ts:14

Reference implementation of [HistoryStore](/reference/engine/interfaces/historystore/) backed by a nested map.

The check-and-insert inside `append` is a single synchronous block, which
is atomic in single-process JavaScript — no await separates the `has`
check from the `set`, so no other caller can observe the half-state. This
is enough for the in-process reference engine; distributed deployments
must provide a store that delegates atomicity to the backend.

## Type Parameters

### TMeta

`TMeta` = `unknown`

## Returns

[`HistoryStore`](/reference/engine/interfaces/historystore/)\<`TMeta`\>
