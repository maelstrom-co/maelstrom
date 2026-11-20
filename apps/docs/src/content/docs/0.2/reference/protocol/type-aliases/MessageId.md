---
editUrl: false
next: false
prev: false
title: "MessageId"
---

> **MessageId** = [`Brand`](/reference/protocol/type-aliases/brand/)\<`string`, `"MessageId"`\>

Defined in: packages/protocol/src/lib/message.ts:18

Opaque identifier for messages sent to the engine.

Every EngineMessage variant carries one. Used for:
 1. Correlation — EngineOutput echoes the input id, so callers can match
    responses to requests without external bookkeeping.
 2. Deduplication — HistoryManager skips duplicate entries when the same
    MessageId arrives twice in the same session for an assistant_message
    variant.
 3. Audit and trace — log lines and history entries are keyed by MessageId,
    enabling end-to-end request correlation.
