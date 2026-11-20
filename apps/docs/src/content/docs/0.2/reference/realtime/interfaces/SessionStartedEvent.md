---
editUrl: false
next: false
prev: false
title: "SessionStartedEvent"
---

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:59

A new connection attempt started and opened a new generation.

## Properties

### connectionId

> `readonly` **connectionId**: `string`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:65

Unique local identity of this connection attempt.

***

### generation

> `readonly` **generation**: `number`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:63

One-based count of connection attempts made by this session.

***

### type

> `readonly` **type**: `"session.started"`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:61

Discriminant.
