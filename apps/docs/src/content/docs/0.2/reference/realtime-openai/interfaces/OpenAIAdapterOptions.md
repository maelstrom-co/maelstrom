---
editUrl: false
next: false
prev: false
title: "OpenAIAdapterOptions"
---

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:26

Options for constructing an [OpenAIAdapter](/reference/realtime-openai/classes/openaiadapter/).

## Properties

### debug?

> `readonly` `optional` **debug?**: `boolean`

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:38

Enable verbose debug tracing (default false). Inbound provider events are
logged as metadata only; transcripts, audio, identifiers, and raw payloads
are never included.

***

### greetingInterruption?

> `readonly` `optional` **greetingInterruption?**: `boolean` \| [`BrowserVadOptions`](/reference/realtime-openai/interfaces/browservadoptions/)

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:58

Experimental local greeting-interruption configuration (default off).
Omitted or `false` preserves the existing non-interruptible greeting gate.
`true` selects shared defaults; an object selects validated browser-VAD
settings. Enabled connections lazy-load the browser runtime. Local
acceptance is playback-scoped: the first accepted local boundary stops
greeting playback, then flushes one bounded pre-roll. Skip and normal
completion discard the retained tail. Setup and worklet-command failure
fall back to the non-interruptible gate.

***

### mintToken

> `readonly` **mintToken**: () => `Promise`\<[`OpenAITokenGrant`](/reference/realtime-openai/interfaces/openaitokengrant/)\>

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:32

Mints the ephemeral OpenAI realtime client secret this adapter connects
with. Called once per `connect()`. The token handshake is assigned to
the adapter — `RealtimeSession` never sees a credential.

#### Returns

`Promise`\<[`OpenAITokenGrant`](/reference/realtime-openai/interfaces/openaitokengrant/)\>

***

### playbackBargeIn?

> `readonly` `optional` **playbackBargeIn?**: `boolean` \| [`BrowserVadOptions`](/reference/realtime-openai/interfaces/browservadoptions/)

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:67

Experimental local remote-audio gate, default off. Uses the existing mic
capture; never changes provider cancellation or server VAD. Speech onset
disables received audio tracks; speech end plus 200ms of incoming quiet
restores them. Misfires restore immediately. A reply without a quiet gap
can be clipped. Failure falls back to provider-only interruption. Transport
preRollMs is unused. Fixed greetings retain their separate interrupter.

***

### serverVad?

> `readonly` `optional` **serverVad?**: `object`

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:88

OpenAI server-VAD tuning and barge-in policy.

The threshold defaults to `0.5` and must be a finite number in `[0, 1]`.
Barge-in defaults to `immediate`, which preserves OpenAI-managed response
creation and interruption. `transcript-confirmed` disables both provider
flags so the adapter can interrupt on the first non-whitespace provisional
transcription delta and create a response only after the same committed
item has a non-whitespace completed transcript. Delta arrival latency is
nondeterministic, and non-whitespace transcription does not prove that the
sound came from a human speaker.

This configures OpenAI's provider-side VAD only. LiveKit owns browser VAD,
microphone gating, and turn boundaries through `LiveKitAdapter`'s separate
`vad` option.

`transcript-confirmed` requires input transcription. Combining it with
`transcription: false` throws a synchronous `TypeError` from the constructor
before token minting, microphone capture, peer creation, or connection.

#### bargeInMode?

> `readonly` `optional` **bargeInMode?**: `"immediate"` \| `"transcript-confirmed"`

`immediate` (default) derives `create_response: true` and
`interrupt_response: true`. `transcript-confirmed` derives both as false
and requires input transcription.

#### threshold?

> `readonly` `optional` **threshold?**: `number`

Finite OpenAI server-VAD activation threshold in `[0, 1]` (default `0.5`).

***

### synthesizeGreeting?

> `readonly` `optional` **synthesizeGreeting?**: [`SynthesizeGreeting`](/reference/realtime-openai/type-aliases/synthesizegreeting/)

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:109

Fetches WAV bytes for the exact greeting text. Optional — without it the
adapter cannot start greeting speech and returns `not_started` (no browser
TTS fallback). Transport only; does not play audio.

***

### transcription?

> `readonly` `optional` **transcription?**: `false` \| \{ `model?`: `string`; \}

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:47

Input-audio transcription configuration for the realtime session.

Omitted (the default): transcription is enabled with the built-in model.
An object: transcription is enabled with `model` (or the built-in default
when `model` is omitted). `false`: transcription is disabled and no
transcription config is sent in `session.update`.

***

### voice?

> `readonly` `optional` **voice?**: [`OpenAIBuiltInVoice`](/reference/realtime-openai/type-aliases/openaibuiltinvoice/)

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:103

Built-in Realtime/TTS output voice. Defaults to `marin`. Applied to the
initial `session.update` audio.output and passed to
[synthesizeGreeting](/reference/realtime-openai/interfaces/openaiadapteroptions/#synthesizegreeting).
