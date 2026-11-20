---
editUrl: false
next: false
prev: false
title: "ToolCallEvent"
---

> **ToolCallEvent** = [`ToolCalledEvent`](/reference/realtime/interfaces/toolcalledevent/) \| [`ToolResultEvent`](/reference/realtime/interfaces/toolresultevent/) \| [`ToolCancelledEvent`](/reference/realtime/interfaces/toolcancelledevent/)

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:111

Brackets every provider tool call, whatever its name. Recovery outcomes of
`update_ui` requests are separate [ToolOutcomeEvent](/reference/realtime/type-aliases/tooloutcomeevent/)s published
between the two, and both kinds share `callId`.
