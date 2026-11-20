---
editUrl: false
next: false
prev: false
title: "TranscriptObservationFeedOptions"
---

Defined in: packages/realtime/src/lib/transcript-observation-feed.ts:11

Options for [TranscriptObservationFeed](/reference/realtime/classes/transcriptobservationfeed/).

## Properties

### maxTrackedUtterances?

> `readonly` `optional` **maxTrackedUtterances?**: `number`

Defined in: packages/realtime/src/lib/transcript-observation-feed.ts:19

How many recent utterances keep their accumulated text for later
revision. Older ones are forgotten; a later event for a forgotten id
starts that fragment again. Defaults to 256.

***

### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: packages/realtime/src/lib/transcript-observation-feed.ts:13

Monotonic clock in milliseconds. Defaults to `performance.now()`.

#### Returns

`number`
