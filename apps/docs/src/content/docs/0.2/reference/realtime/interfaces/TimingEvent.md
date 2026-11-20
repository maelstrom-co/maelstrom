---
editUrl: false
next: false
prev: false
title: "TimingEvent"
---

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:161

A measured duration of `update_ui` work, such as its render or its failure.

## Properties

### label

> `readonly` **label**: `string`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:165

What was measured, for example `update_ui.render` or `update_ui.error`.

***

### ms

> `readonly` **ms**: `number`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:167

Client-clock duration in milliseconds.

***

### type

> `readonly` **type**: `"timing"`

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:163

Discriminant.
