---
editUrl: false
next: false
prev: false
title: "TranscriptFragmentEvent"
---

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:69

Adapter transcript evidence, relayed only after the session fenced stale connections.

## Properties

### connectionId

> `readonly` **connectionId**: `string`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:75

Local identity of the connection the fragment was observed on.

***

### fragment

> `readonly` **fragment**: `TimedTranscriptFragment`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:77

The fragment exactly as the adapter reported it, not yet validated.

***

### generation

> `readonly` **generation**: `number`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:73

Connection generation the fragment was observed in.

***

### type

> `readonly` **type**: `"transcript.fragment"`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:71

Discriminant.
