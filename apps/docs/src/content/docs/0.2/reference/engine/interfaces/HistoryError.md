---
editUrl: false
next: false
prev: false
title: "HistoryError"
---

Defined in: packages/engine/src/lib/errors.ts:105

Raised when the configured `HistoryStore` fails. Distinct from
[ProviderError](/reference/engine/interfaces/providererror/): that one is the LLM adapter; history persistence
is a separate subsystem, and callers typically route the two failure
modes to different recovery strategies (LLM retry / fallback vs. store
reconnection / degraded mode).

`operation` discriminates the failing call site so callers can branch
without string-matching `message`. Today the engine emits three members
on its public Err channel: `add_assistant_message` from the
`assistant_message` entry point, `get_llm_context` from `chart_request`
history-context loading, and `get_history` from [Engine.getHistory](/reference/engine/interfaces/engine/#gethistory).
`record_turn` and `clear` are reserved tags — `recordTurn` failures in
the `chart_request` arm are advisory (logged but not returned); `clear`
is exposed on the public `HistoryManager` interface but not surfaced
through `Engine.handle`. `leader_pipeline` is a defensive catch-all kept
as a follower-hang guard inside the idempotency machinery in
[Engine.handle](/reference/engine/interfaces/engine/#handle) — unreachable under normal operation (every
per-stage error path returns via the Result channel), but if some future
refactor lets a throw escape, followers awaiting the in-flight leader
observe this discriminant instead of hanging forever.

## Properties

### \_tag

> `readonly` **\_tag**: `"HistoryError"`

Defined in: packages/engine/src/lib/errors.ts:106

***

### cause

> `readonly` **cause**: `unknown`

Defined in: packages/engine/src/lib/errors.ts:115

***

### message

> `readonly` **message**: `string`

Defined in: packages/engine/src/lib/errors.ts:107

***

### operation

> `readonly` **operation**: `"record_turn"` \| `"add_assistant_message"` \| `"clear"` \| `"get_llm_context"` \| `"get_history"` \| `"leader_pipeline"`

Defined in: packages/engine/src/lib/errors.ts:108

***

### stack?

> `readonly` `optional` **stack?**: `string`

Defined in: packages/engine/src/lib/errors.ts:116
