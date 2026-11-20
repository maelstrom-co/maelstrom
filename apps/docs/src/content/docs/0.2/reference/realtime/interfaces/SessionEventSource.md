---
editUrl: false
next: false
prev: false
title: "SessionEventSource"
---

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:224

Read-only access to one session's events. Delivery is synchronous, in
publish order, with no replay: a subscriber sees only events published
after it subscribed. A subscriber that throws is isolated from the others.

## Methods

### subscribe()

> **subscribe**(`handler`): `Unsubscribe`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:226

Delivers every later event to `handler` until the returned release is called.

#### Parameters

##### handler

[`SessionEventHandler`](/reference/realtime/type-aliases/sessioneventhandler/)

#### Returns

`Unsubscribe`
