---
editUrl: false
next: false
prev: false
title: "UseVoiceObservationsResult"
---

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:207

Continuous observations and controls using the same provider lifetime as useVoice.

## Properties

### session

> `readonly` **session**: `RealtimeSession`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:211

Shared session for lifecycle controls and generated-opening requests.

***

### snapshot

> `readonly` **snapshot**: `VoiceObservationSnapshot`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:209

Shared retained snapshot; timed fragments are never accumulated as legacy turns.
