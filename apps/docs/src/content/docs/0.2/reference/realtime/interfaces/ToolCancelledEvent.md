---
editUrl: false
next: false
prev: false
title: "ToolCancelledEvent"
---

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:151

A call was observed but connection cancellation prevented its dispatch.

## Properties

### callId

> `readonly` **callId**: `ToolCallId`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:157

Provider correlation identity of the undispatched call.

***

### generation

> `readonly` **generation**: `number`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:155

Original session generation.

***

### type

> `readonly` **type**: `"tool.cancelled"`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:153

Discriminant.
