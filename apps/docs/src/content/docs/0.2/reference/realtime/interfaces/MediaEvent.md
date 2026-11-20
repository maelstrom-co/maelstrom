---
editUrl: false
next: false
prev: false
title: "MediaEvent"
---

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:97

Adapter media evidence, relayed only after the session fenced stale connections.

## Properties

### generation

> `readonly` **generation**: `number`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:101

Connection generation the evidence belongs to.

***

### media

> `readonly` **media**: `Partial`\<`VoiceMediaObservation`\>

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:103

Changed media fields only; absent fields keep their previous value.

***

### type

> `readonly` **type**: `"media"`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:99

Discriminant.
