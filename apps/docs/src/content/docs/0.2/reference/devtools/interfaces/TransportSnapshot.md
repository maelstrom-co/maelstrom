---
editUrl: false
next: false
prev: false
title: "TransportSnapshot"
---

Defined in: packages/devtools/src/voice-diagnostics.ts:2

Provider-neutral projection of optional transport facts.

## Properties

### contextUsageRatio?

> `readonly` `optional` **contextUsageRatio?**: `number`

Defined in: packages/devtools/src/voice-diagnostics.ts:8

Reported context fraction, when available.

***

### finalization

> `readonly` **finalization**: `string`

Defined in: packages/devtools/src/voice-diagnostics.ts:9

Provider finalization status.

***

### finalUsageSeconds?

> `readonly` `optional` **finalUsageSeconds?**: `number`

Defined in: packages/devtools/src/voice-diagnostics.ts:7

Final reported usage, when available.

***

### generation

> `readonly` **generation**: `number`

Defined in: packages/devtools/src/voice-diagnostics.ts:4

Connection generation.

***

### playback

> `readonly` **playback**: `string`

Defined in: packages/devtools/src/voice-diagnostics.ts:10

Local playback status.

***

### sessionId?

> `readonly` `optional` **sessionId?**: `string`

Defined in: packages/devtools/src/voice-diagnostics.ts:3

Provider session identifier when safe to expose.

***

### state

> `readonly` **state**: `string`

Defined in: packages/devtools/src/voice-diagnostics.ts:5

Observed lifecycle state.

***

### usageSeconds?

> `readonly` `optional` **usageSeconds?**: `number`

Defined in: packages/devtools/src/voice-diagnostics.ts:6

Reported usage, when available.
