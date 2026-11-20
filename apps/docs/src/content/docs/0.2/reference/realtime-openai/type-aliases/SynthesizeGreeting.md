---
editUrl: false
next: false
prev: false
title: "SynthesizeGreeting"
---

> **SynthesizeGreeting** = (`args`) => `Promise`\<`ArrayBuffer`\>

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:21

Transport-only greeting synthesizer. Returns WAV bytes; must not play audio
or rewrite text. Playback is owned by the adapter's internal Web Audio player.

## Parameters

### args

[`SynthesizeGreetingArgs`](/reference/realtime-openai/interfaces/synthesizegreetingargs/)

## Returns

`Promise`\<`ArrayBuffer`\>
