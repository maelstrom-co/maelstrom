---
editUrl: false
next: false
prev: false
title: "EngineMessage"
---

> **EngineMessage** = [`ChartRequestMessage`](/reference/protocol/interfaces/chartrequestmessage/) \| [`AssistantInjectionMessage`](/reference/protocol/interfaces/assistantinjectionmessage/)

Defined in: packages/protocol/src/lib/engine-message.ts:67

Tagged union of every input the engine knows how to handle. Adding a new
message kind (audio intent, system notification, etc.) means adding a
variant here and a new branch in the engine's router.
