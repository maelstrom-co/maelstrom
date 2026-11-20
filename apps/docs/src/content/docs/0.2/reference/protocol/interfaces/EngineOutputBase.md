---
editUrl: false
next: false
prev: false
title: "EngineOutputBase"
---

Defined in: packages/protocol/src/lib/engine-output.ts:10

Common metadata on every engine output. The `id` echoes the id of the input
message that produced this output, so callers can correlate
response-to-request without external bookkeeping.

## Extended by

- [`AssistantMessageResultOutput`](/reference/protocol/interfaces/assistantmessageresultoutput/)
- [`ChartResponseOutput`](/reference/protocol/interfaces/chartresponseoutput/)

## Properties

### id

> `readonly` **id**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/engine-output.ts:12

***

### sessionId

> `readonly` **sessionId**: [`SessionId`](/reference/protocol/type-aliases/sessionid/)

Defined in: packages/protocol/src/lib/engine-output.ts:11
