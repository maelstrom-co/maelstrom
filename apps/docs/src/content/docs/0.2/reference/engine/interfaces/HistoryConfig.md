---
editUrl: false
next: false
prev: false
title: "HistoryConfig"
---

Defined in: packages/engine/src/lib/history/history-manager.ts:29

Persistence, retention, and prompt-projection policy for Engine history.

## Type Parameters

### TMeta

`TMeta` = `unknown`

## Properties

### deriveLLMContext?

> `readonly` `optional` **deriveLLMContext?**: (`entry`, `defaults`) => readonly [`LLMContextMessage`](/reference/engine/interfaces/llmcontextmessage/)[]

Defined in: packages/engine/src/lib/history/history-manager.ts:69

Optional projection from a stored entry to the LLM-context messages it
contributes. Called once per retained entry during `getLLMContext` and
once per entry during truncation cost estimation, so keep the projection
cheap and side-effect-free. When omitted, the engine uses its default
projection: turns produce a user message (from user_intent reasons) +
an assistant message (from the response's userMessage); injections
produce a single assistant message.

The `defaults` callback returns the engine's default projection for the
same entry, enabling compose-with-default overrides without reimplementing
the full projection. Call it from any branch that should fall through to
default behavior; ignore it entirely for a full replacement.

Override to expose richer stored `metadata` to the LLM, rewrite roles,
or merge multiple entries into a single context message.

#### Parameters

##### entry

[`HistoryEntry`](/reference/engine/type-aliases/historyentry/)\<`TMeta`\>

##### defaults

() => readonly [`LLMContextMessage`](/reference/engine/interfaces/llmcontextmessage/)[]

#### Returns

readonly [`LLMContextMessage`](/reference/engine/interfaces/llmcontextmessage/)[]

***

### maxChars?

> `readonly` `optional` **maxChars?**: `number`

Defined in: packages/engine/src/lib/history/history-manager.ts:44

Budget for total characters in retained LLM-context projections. Omit to
disable it. With [createEngine](/reference/engine/functions/createengine/), this must be a positive integer and
an `assistant_message` whose `content.length` exceeds it is rejected.
Truncation retains the newest entry even if its projection alone exceeds
the budget. Direct [createHistoryManager](/reference/engine/functions/createhistorymanager/) calls skip those Engine
boundary checks; a non-positive value retains no entries.

***

### maxEntries?

> `readonly` `optional` **maxEntries?**: `number`

Defined in: packages/engine/src/lib/history/history-manager.ts:35

Hard cap on per-session entry count. Omit to disable the entry-count
cap entirely — truncation then relies solely on `maxChars` (or becomes
a no-op if that is also omitted).

***

### store

> `readonly` **store**: [`HistoryStore`](/reference/engine/interfaces/historystore/)\<`TMeta`\>

Defined in: packages/engine/src/lib/history/history-manager.ts:81

Backing store. Required — the engine never silently defaults to an
in-process store. Local dev and tests should pass `createInMemoryStore()`
explicitly; production deployments supply a persistent, atomic store.
Making this explicit prevents the footgun of shipping a configured
`history` block to production and silently losing every session on
process restart.

***

### transformEntry?

> `readonly` `optional` **transformEntry?**: (`entry`) => [`HistoryEntry`](/reference/engine/type-aliases/historyentry/)\<`TMeta`\>

Defined in: packages/engine/src/lib/history/history-manager.ts:51

Optional per-entry transform applied before persistence. Runs for both
`turn` and `injection` entries. Use to strip fields a production store
doesn't need (rationale, vessel snapshots, etc.) — or to enrich entries
with typed `metadata` before they're stored.

#### Parameters

##### entry

[`HistoryEntry`](/reference/engine/type-aliases/historyentry/)\<`TMeta`\>

#### Returns

[`HistoryEntry`](/reference/engine/type-aliases/historyentry/)\<`TMeta`\>
