---
editUrl: false
next: false
prev: false
title: "VoiceObservationSnapshot"
---

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:83

Shared, bounded observations for a voice session. Legacy turns use a separate channel.

## Properties

### applicationWork

> `readonly` **applicationWork**: [`VoiceApplicationWork`](/reference/client/interfaces/voiceapplicationwork/)

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:91

Current application observations, independent of voice connectivity.

***

### captions

> `readonly` **captions**: readonly [`VoiceCaption`](/reference/client/interfaces/voicecaption/)[]

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:95

Revisable display groups derived from the retained fragments.

***

### connection

> `readonly` **connection**: [`VoiceConnectionState`](/reference/client/type-aliases/voiceconnectionstate/)

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:87

Provider connection lifecycle, not a conversation turn state.

***

### fragments

> `readonly` **fragments**: readonly [`TimedTranscriptFragment`](/reference/client/interfaces/timedtranscriptfragment/)[]

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:93

Bounded raw fragments ordered by start time, then first receipt for ties; reset on a new connection attempt.

***

### generation

> `readonly` **generation**: `number`

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:85

Local connection attempt number; timestamps and fragment IDs are scoped to this value.

***

### media

> `readonly` **media**: [`VoiceMediaObservation`](/reference/client/interfaces/voicemediaobservation/)

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:89

Current generation's observed media activity.
