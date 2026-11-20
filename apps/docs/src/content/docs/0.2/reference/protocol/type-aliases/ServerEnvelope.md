---
editUrl: false
next: false
prev: false
title: "ServerEnvelope"
---

> **ServerEnvelope** = [`MaelstromResponseMessage`](/reference/protocol/interfaces/maelstromresponsemessage/) \| [`HistoryResponseMessage`](/reference/protocol/interfaces/historyresponsemessage/) \| [`AssistantMessageResultMessage`](/reference/protocol/interfaces/assistantmessageresultmessage/) \| [`EngineErrorMessage`](/reference/protocol/interfaces/engineerrormessage/) \| [`DiagnosticMessage`](/reference/protocol/type-aliases/diagnosticmessage/) \| [`AgentEventMessage`](/reference/protocol/interfaces/agenteventmessage/)

Defined in: packages/protocol/src/lib/envelope.ts:452

Every message an engine host may send to a client over the duplex stream,
discriminated on `type`. See the union members below.
