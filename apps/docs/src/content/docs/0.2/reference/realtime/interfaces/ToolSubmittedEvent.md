---
editUrl: false
next: false
prev: false
title: "ToolSubmittedEvent"
---

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:187

An `update_ui` intent began processing, or entered a legacy immediate bridge.

## Properties

### callId

> `readonly` **callId**: `ToolCallId`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:191

Local correlation identity of the request.

***

### intent

> `readonly` **intent**: `string`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:193

Requested natural-language intent.

***

### retry

> `readonly` **retry**: `boolean`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:195

Legacy retry marker. Shared FIFO admission never retries and emits false.

***

### type

> `readonly` **type**: `"tool.submitted"`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:189

Discriminant.
