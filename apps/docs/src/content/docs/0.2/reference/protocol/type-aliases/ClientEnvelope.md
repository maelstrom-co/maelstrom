---
editUrl: false
next: false
prev: false
title: "ClientEnvelope"
---

> **ClientEnvelope** = [`ChartRequestMessage`](/reference/protocol/interfaces/chartrequestmessage/) \| [`AssistantInjectionMessage`](/reference/protocol/interfaces/assistantinjectionmessage/) \| [`AcknowledgedAssistantMessage`](/reference/protocol/interfaces/acknowledgedassistantmessage/) \| [`HistoryGetMessage`](/reference/protocol/interfaces/historygetmessage/) \| [`DiagnosticSubscription`](/reference/protocol/type-aliases/diagnosticsubscription/) \| [`AgentInputMessage`](/reference/protocol/interfaces/agentinputmessage/)

Defined in: packages/protocol/src/lib/envelope.ts:188

Every message a client may send to an engine host over the duplex stream.

Every [ChartRequestMessage](/reference/protocol/variables/chartrequestmessage/) / [AssistantInjectionMessage](/reference/protocol/variables/assistantinjectionmessage/) —
i.e. every `EngineMessage` — is a valid ClientEnvelope; the envelope module
adds the transport-only [HistoryGetMessage](/reference/protocol/variables/historygetmessage/),
[AcknowledgedAssistantMessage](/reference/protocol/variables/acknowledgedassistantmessage/) and [DiagnosticSubscription](/reference/protocol/type-aliases/diagnosticsubscription/),
which the LLM never sees, and the [AgentInputMessage](/reference/protocol/variables/agentinputmessage/) that feeds the
Agent Session. The legacy assistant arm remains fire-and-forget; only the
acknowledged arm requests a response. Discriminated on `type`, so a host
router can use one switch.
