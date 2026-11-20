---
editUrl: false
next: false
prev: false
title: "VoiceMediaObservation"
---

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:15

Media evidence for the current provider generation, never an audible-playback guarantee.

## Properties

### incomingAudio

> `readonly` **incomingAudio**: [`VoiceActivity`](/reference/client/type-aliases/voiceactivity/)

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:21

Evidence that remote audio is arriving, not that a person heard it.

***

### microphone

> `readonly` **microphone**: [`VoiceActivity`](/reference/client/type-aliases/voiceactivity/)

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:17

Whether microphone capture is enabled, not whether the user is speaking.

***

### userSpeech

> `readonly` **userSpeech**: [`VoiceActivity`](/reference/client/type-aliases/voiceactivity/)

Defined in: packages/client/src/lib/voice-session/voice-observations.ts:19

Provider or detector evidence of user speech.
