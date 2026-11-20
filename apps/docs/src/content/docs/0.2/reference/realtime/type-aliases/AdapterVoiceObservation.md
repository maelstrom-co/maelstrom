---
editUrl: false
next: false
prev: false
title: "AdapterVoiceObservation"
---

> **AdapterVoiceObservation** = \{ `media`: `Partial`\<`VoiceMediaObservation`\>; `type`: `"media"`; \} \| \{ `fragment`: `TimedTranscriptFragment`; `type`: `"fragment"`; \}

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:319

Continuous provider evidence. This channel never implies a legacy final turn.

## Union Members

### Type Literal

\{ `media`: `Partial`\<`VoiceMediaObservation`\>; `type`: `"media"`; \}

#### media

> `readonly` **media**: `Partial`\<`VoiceMediaObservation`\>

Only fields backed by current evidence; other fields retain their value.

#### type

> `readonly` **type**: `"media"`

Media observation discriminator.

***

### Type Literal

\{ `fragment`: `TimedTranscriptFragment`; `type`: `"fragment"`; \}

#### fragment

> `readonly` **fragment**: `TimedTranscriptFragment`

New or revised raw fragment on this connection's media timeline.

#### type

> `readonly` **type**: `"fragment"`

Timed fragment discriminator.
