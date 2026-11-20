---
editUrl: false
next: false
prev: false
title: "SessionHistoryEntry"
---

> **SessionHistoryEntry** = \{ `assistantMessage`: `string`; `id`: [`MessageId`](/reference/protocol/type-aliases/messageid/); `kind`: `"turn"`; `sessionId`: [`SessionId`](/reference/protocol/type-aliases/sessionid/); `timestamp`: `number`; `userIntent`: `string`; \} \| \{ `content`: `string`; `id`: [`MessageId`](/reference/protocol/type-aliases/messageid/); `kind`: `"injection"`; `sessionId`: [`SessionId`](/reference/protocol/type-aliases/sessionid/); `timestamp`: `number`; \}

Defined in: packages/protocol/src/lib/session-history-entry.ts:43

Wire-format projection of a single recorded history entry, returned by
`Engine.getHistory` and surfaced to clients through the connector and
orchestrator layers.

Intentionally smaller than the engine's internal storage record: the
engine persists the full `ChartRequestMessage` (vessel definitions,
instances, prior layout) and `ChartResponseOutput` (execution plan, full
layout grid) to support cache replay and prompt assembly. Clients
resuming a conversation only need enough to render the chat — the user's
intent and the assistant's reply — so the wire DTO carries those
directly and lets the engine evolve its internal storage shape without
breaking the contract.

`kind` discriminates a chart_request round-trip (`turn`) from a
developer-supplied assistant message (`injection`).

 - `turn`: `userIntent` is the user-facing text the engine derived from
   the originating request's `user_intent` UpdateReasons. May be `''` when
   the turn carried no user-intent reasons (e.g. a layout-only update from
   a resize) — empty is a legal value with semantic meaning ("no user input
   on this turn"). `assistantMessage` is the assistant's reply.
 - `injection`: `content` is the injected assistant text verbatim.

The exact derivation of `userIntent` is the engine's choice — the reference
engine concatenates every `user_intent` UpdateReason with a single-space
separator. Other engines may project differently; clients SHOULD treat the
field as opaque text suitable for direct rendering.

`id`, `sessionId`, and `timestamp` come straight from the originating
envelope — `id` is the engine-input MessageId so callers can dedupe
against locally-known requests, and `timestamp` is the wall-clock the
client originally stamped (guaranteed finite by the wire schema).
