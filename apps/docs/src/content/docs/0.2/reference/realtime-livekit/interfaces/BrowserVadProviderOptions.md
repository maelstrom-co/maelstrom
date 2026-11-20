---
editUrl: false
next: false
prev: false
title: "BrowserVadProviderOptions"
---

Defined in: packages/realtime-vad/dist/browser-vad.types.d.ts:14

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

Defined in: packages/realtime-vad/dist/browser-vad.types.d.ts:29

Shortest segment treated as speech, in non-negative milliseconds.

***

### model?

> `readonly` `optional` **model?**: `"v5"` \| `"legacy"`

Defined in: packages/realtime-vad/dist/browser-vad.types.d.ts:16

Silero generation to load: `'v5'` or `'legacy'`.

***

### negativeSpeechThreshold?

> `readonly` `optional` **negativeSpeechThreshold?**: `number`

Defined in: packages/realtime-vad/dist/browser-vad.types.d.ts:20

Confidence at which a frame stops counting as speech, from 0 through 1.

***

### positiveSpeechThreshold?

> `readonly` `optional` **positiveSpeechThreshold?**: `number`

Defined in: packages/realtime-vad/dist/browser-vad.types.d.ts:18

Confidence required to treat a frame as speech, from 0 through 1.

***

### preSpeechPadMs?

> `readonly` `optional` **preSpeechPadMs?**: `number`

Defined in: packages/realtime-vad/dist/browser-vad.types.d.ts:27

Audio prepended to the provider's detected segment, in milliseconds. This
affects detection only and does not populate transport `preRollMs`.

***

### processorType?

> `readonly` `optional` **processorType?**: `"auto"` \| `"AudioWorklet"` \| `"ScriptProcessor"`

Defined in: packages/realtime-vad/dist/browser-vad.types.d.ts:31

Audio processor strategy: `'AudioWorklet'`, `'ScriptProcessor'`, or `'auto'`.

***

### redemptionMs?

> `readonly` `optional` **redemptionMs?**: `number`

Defined in: packages/realtime-vad/dist/browser-vad.types.d.ts:22

Silence a turn survives before speech end, in non-negative milliseconds.

***

### workletOptions?

> `readonly` `optional` **workletOptions?**: `AudioWorkletNodeOptions`

Defined in: packages/realtime-vad/dist/browser-vad.types.d.ts:33

AudioWorklet construction options; lifecycle callbacks remain adapter-owned.
