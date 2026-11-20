---
editUrl: false
next: false
prev: false
title: "ToolCalledEvent"
---

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:117

A provider tool call arrived and is about to be dispatched.

## Properties

### argumentsJson

> `readonly` **argumentsJson**: `string`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:127

Raw JSON arguments exactly as the provider sent them; may contain user speech.

***

### callId

> `readonly` **callId**: `ToolCallId`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:123

Provider correlation identity of the call.

***

### generation?

> `readonly` `optional` **generation?**: `number`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:121

Session generation captured before subscriber callbacks. Absent in legacy events.

***

### name

> `readonly` **name**: `string`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:125

Tool name as the provider sent it, including names the session does not know.

***

### type

> `readonly` **type**: `"tool.called"`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:119

Discriminant.
