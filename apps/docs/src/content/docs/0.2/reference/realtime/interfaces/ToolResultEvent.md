---
editUrl: false
next: false
prev: false
title: "ToolResultEvent"
---

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:137

Local handling of a tool call finished. Provider delivery is best-effort:
this event can follow a started, failed or skipped send; it neither waits for
delivery nor confirms receipt.
It is not published when a disconnect or reconnect starts between the call's
arrival and its dispatch.

## Properties

### callId

> `readonly` **callId**: `ToolCallId`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:143

Provider correlation identity of the call.

***

### generation?

> `readonly` `optional` **generation?**: `number`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:141

Original session generation, even when handling settles after reconnect.

***

### latencyMs

> `readonly` **latencyMs**: `number`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:147

Client-clock milliseconds from arrival until local handling finishes.

***

### ok

> `readonly` **ok**: `boolean`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:145

Whether the tool succeeded; for `update_ui`, whether the change rendered.

***

### type

> `readonly` **type**: `"tool.result"`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:139

Discriminant.
