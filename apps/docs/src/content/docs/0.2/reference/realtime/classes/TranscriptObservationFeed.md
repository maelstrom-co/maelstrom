---
editUrl: false
next: false
prev: false
title: "TranscriptObservationFeed"
---

Defined in: packages/realtime/src/lib/transcript-observation-feed.ts:35

An [AdapterVoiceObservations](/reference/realtime/interfaces/adaptervoiceobservations/) feed for providers that report
transcript text but no media timestamps. Each fragment id names one
utterance: [append](/reference/realtime/classes/transcriptobservationfeed/#append) revises that fragment in place with the text so
far, and [complete](/reference/realtime/classes/transcriptobservationfeed/#complete) replaces it with the provider's full text and
marks it final, so a final event never duplicates streamed text.

Times are local receipt times in milliseconds since the last
[restart](/reference/realtime/classes/transcriptobservationfeed/#restart). They approximate the connection's media timeline rather
than measure it. The feed reports no media evidence, so media stays
`unknown` for its consumers. Adapters remain responsible for dropping
callbacks from a stale connection before they reach the feed.

## Implements

- [`AdapterVoiceObservations`](/reference/realtime/interfaces/adaptervoiceobservations/)

## Constructors

### Constructor

> **new TranscriptObservationFeed**(`options?`): `TranscriptObservationFeed`

Defined in: packages/realtime/src/lib/transcript-observation-feed.ts:43

Creates an idle feed whose timeline starts now.

#### Parameters

##### options?

[`TranscriptObservationFeedOptions`](/reference/realtime/interfaces/transcriptobservationfeedoptions/) = `{}`

#### Returns

`TranscriptObservationFeed`

## Methods

### append()

> **append**(`id`, `role`, `delta`): `void`

Defined in: packages/realtime/src/lib/transcript-observation-feed.ts:73

Appends streamed text to utterance `id`, publishing the whole text so far
under the same id. Empty deltas and deltas after completion are ignored.

#### Parameters

##### id

`string`

##### role

`"user"` \| `"assistant"`

##### delta

`string`

#### Returns

`void`

***

### complete()

> **complete**(`id`, `role`, `text`): `void`

Defined in: packages/realtime/src/lib/transcript-observation-feed.ts:97

Revises utterance `id` to the provider's full `text` and marks it final.
An utterance never seen before is published whole, unless its text is
empty, because an empty first report carries no evidence.

#### Parameters

##### id

`string`

##### role

`"user"` \| `"assistant"`

##### text

`string`

#### Returns

`void`

***

### restart()

> **restart**(): `void`

Defined in: packages/realtime/src/lib/transcript-observation-feed.ts:64

Starts a new connection timeline at zero and forgets every tracked utterance.

#### Returns

`void`

***

### subscribe()

> `readonly` **subscribe**(`handler`): `Unsubscribe`

Defined in: packages/realtime/src/lib/transcript-observation-feed.ts:54

Observes fragments. A throwing handler never affects other handlers or the adapter.

#### Parameters

##### handler

(`event`) => `void`

#### Returns

`Unsubscribe`

#### Implementation of

[`AdapterVoiceObservations`](/reference/realtime/interfaces/adaptervoiceobservations/).[`subscribe`](/reference/realtime/interfaces/adaptervoiceobservations/#subscribe)
