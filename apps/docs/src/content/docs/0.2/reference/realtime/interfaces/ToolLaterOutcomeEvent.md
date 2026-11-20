---
editUrl: false
next: false
prev: false
title: "ToolLaterOutcomeEvent"
---

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:199

Admission or application evidence for an `update_ui` request.

## Properties

### callId

> `readonly` **callId**: `ToolCallId`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:203

Local correlation identity of the request.

***

### intent

> `readonly` **intent**: `string`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:205

Requested natural-language intent.

***

### summary?

> `readonly` `optional` **summary?**: `string`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:207

Bounded application evidence; absence does not mean success.

***

### type

> `readonly` **type**: [`ToolLaterOutcomeType`](/reference/realtime/type-aliases/toollateroutcometype/)

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:201

Discriminant. `tool.unconfirmed` means the application result is unknown.
