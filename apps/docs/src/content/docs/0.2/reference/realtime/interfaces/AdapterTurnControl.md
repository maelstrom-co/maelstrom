---
editUrl: false
next: false
prev: false
title: "AdapterTurnControl"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:141

Manual turn-boundary control for adapters that establish manual mode.
`startTurn` opens the mic / STT stream, while `endTurn` flushes it and
triggers the provider's turn-final transcript. An adapter may expose or
replace this control dynamically when automatic detection degrades; speech-
native providers detect turns themselves and omit it.

An implementation decides what starting and ending a turn means; for example,
it may unmute a microphone, open an STT stream, or flush buffered audio.
Depending on the provider, calls while disconnected or with no captured
audio may be no-ops, and an empty turn may produce no transcript.
Operational failures may arrive as adapter error events while these promises
resolve. For a fatal [RealtimeVoiceError](/reference/realtime/classes/realtimevoiceerror/), `RealtimeSession` exposes
`state === 'error'` and preserves the cause in `lastError`, so consumers must
observe both values.
OpenAIAdapter omits `turnControl` because OpenAI owns turn detection.

Invariant: `RealtimeSession` NEVER calls these methods — they exist purely
for the binding/UI layer to drive. The session stays agnostic to whether a
provider is push-to-talk; only the surface that renders controls acts on
this capability.

## Methods

### endTurn()

> **endTurn**(): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:145

Request the provider-defined end of a turn; an empty turn may produce no transcript.

#### Returns

`Promise`\<`void`\>

***

### startTurn()

> **startTurn**(): `Promise`\<`void`\>

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:143

Request the provider-defined start of a user turn; this may be a no-op.

#### Returns

`Promise`\<`void`\>
