---
editUrl: false
next: false
prev: false
title: "SynthesizeGreetingArgs"
---

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:8

Arguments passed to an injected greeting synthesizer.

## Properties

### signal

> `readonly` **signal**: `AbortSignal`

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:14

Signals that pending synthesis must stop promptly when the greeting or voice session stops.

***

### text

> `readonly` **text**: `string`

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:10

Exact greeting text — must not be altered by the synthesizer.

***

### voice

> `readonly` **voice**: [`OpenAIBuiltInVoice`](/reference/realtime-openai/type-aliases/openaibuiltinvoice/)

Defined in: packages/realtime-openai/src/openai-adapter.types.ts:12

Configured built-in voice (same value as Realtime session output).
