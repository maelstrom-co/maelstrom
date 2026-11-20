---
editUrl: false
next: false
prev: false
title: "BrowserVadProviderOptions"
---

Defined in: packages/realtime-vad/src/browser-vad.types.ts:15

Detection tuning passed through to the VAD provider.

This is an allowlist, not a partial of the provider's options. Streams,
callbacks, lifecycle, asset paths, audio contexts, ONNX Runtime
configuration, and start policy stay adapter-owned.

Stricter thresholds cut false starts and begin missing quiet speech. Longer
silence handling preserves natural pauses and delays the end of every turn.
Tune against representative speakers, microphones, browsers, playback
volume, and background noise.

## Properties

### minSpeechMs?

> `readonly` `optional` **minSpeechMs?**: `number`

Defined in: packages/realtime-vad/src/browser-vad.types.ts:30

Shortest segment treated as speech, in non-negative milliseconds.

***

### model?

> `readonly` `optional` **model?**: `"v5"` \| `"legacy"`

Defined in: packages/realtime-vad/src/browser-vad.types.ts:17

Silero generation to load: `'v5'` or `'legacy'`.

***

### negativeSpeechThreshold?

> `readonly` `optional` **negativeSpeechThreshold?**: `number`

Defined in: packages/realtime-vad/src/browser-vad.types.ts:21

Confidence at which a frame stops counting as speech, from 0 through 1.

***

### positiveSpeechThreshold?

> `readonly` `optional` **positiveSpeechThreshold?**: `number`

Defined in: packages/realtime-vad/src/browser-vad.types.ts:19

Confidence required to treat a frame as speech, from 0 through 1.

***

### preSpeechPadMs?

> `readonly` `optional` **preSpeechPadMs?**: `number`

Defined in: packages/realtime-vad/src/browser-vad.types.ts:28

Audio prepended to the provider's detected segment, in milliseconds. This
affects detection only and does not populate transport `preRollMs`.

***

### processorType?

> `readonly` `optional` **processorType?**: `"AudioWorklet"` \| `"ScriptProcessor"` \| `"auto"`

Defined in: packages/realtime-vad/src/browser-vad.types.ts:32

Audio processor strategy: `'AudioWorklet'`, `'ScriptProcessor'`, or `'auto'`.

***

### redemptionMs?

> `readonly` `optional` **redemptionMs?**: `number`

Defined in: packages/realtime-vad/src/browser-vad.types.ts:23

Silence a turn survives before speech end, in non-negative milliseconds.

***

### workletOptions?

> `readonly` `optional` **workletOptions?**: `AudioWorkletNodeOptions`

Defined in: packages/realtime-vad/src/browser-vad.types.ts:34

AudioWorklet construction options; lifecycle callbacks remain adapter-owned.
