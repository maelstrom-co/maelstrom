---
editUrl: false
next: false
prev: false
title: "ToolOutcomeEvent"
---

> **ToolOutcomeEvent** = [`ToolSubmittedEvent`](/reference/realtime/interfaces/toolsubmittedevent/) \| [`ToolLaterOutcomeEvent`](/reference/realtime/interfaces/toollateroutcomeevent/)

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:176

Recovery outcome of one `update_ui` request. Every variant carries the
request's intent, so a subscriber never has to ask the session for it.
Outcomes carry no generation because submitted work can finish after voice
ends and still belongs to the same request.
