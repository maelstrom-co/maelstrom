---
editUrl: false
next: false
prev: false
title: "GreetingRunContext"
---

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:18

Inputs for one greeting generation. Each successful
import('./realtime-session/realtime-session.js').RealtimeSession.connect
that reaches `connected` is one generation.

## Properties

### adapter

> `readonly` **adapter**: [`RealtimeGreetingAdapter`](/reference/realtime/interfaces/realtimegreetingadapter/)

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:22

***

### emitTranscript

> `readonly` **emitTranscript**: (`text`) => `void`

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:25

Emit one assistant caption through the session's transcript channel.

#### Parameters

##### text

`string`

#### Returns

`void`

***

### instance

> `readonly` **instance**: [`RealtimeInstance`](/reference/realtime/interfaces/realtimeinstance/)

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:21

***

### sessionId

> `readonly` **sessionId**: `SessionId`

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:19

***

### signal

> `readonly` **signal**: `AbortSignal`

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:23

***

### text

> `readonly` **text**: `string`

Defined in: packages/realtime/src/lib/greeting-coordinator.ts:20
