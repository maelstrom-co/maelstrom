---
editUrl: false
next: false
prev: false
title: "createHistoryManager"
---

> **createHistoryManager**\<`TMeta`\>(`config`): [`HistoryManager`](/reference/engine/interfaces/historymanager/)\<`TMeta`\>

Defined in: packages/engine/src/lib/history/history-manager.ts:150

Construct a [HistoryManager](/reference/engine/interfaces/historymanager/) from the given config. The passed-in
[HistoryStore](/reference/engine/interfaces/historystore/) is the only persistence boundary; this manager adds
per-session mutual exclusion (for `recordTurn`), truncation policy, and
the default LLM-context projection on top.

Most consumers should let `createEngine` wire this up via
[EngineConfig.history](/reference/engine/interfaces/engineconfig/#history). Construct directly only when assembling a
custom engine pipeline that needs the manager outside `createEngine`.

## Type Parameters

### TMeta

`TMeta` = `unknown`

## Parameters

### config

[`HistoryConfig`](/reference/engine/interfaces/historyconfig/)\<`TMeta`\>

## Returns

[`HistoryManager`](/reference/engine/interfaces/historymanager/)\<`TMeta`\>
