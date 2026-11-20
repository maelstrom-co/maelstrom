---
editUrl: false
next: false
prev: false
title: "projectLiveTransport"
---

> **projectLiveTransport**\<`T`\>(`snapshot`): `object`

Defined in: packages/devtools/src/voice-diagnostics.ts:243

Projects only provider-neutral transport facts and safe correlation identity.

## Type Parameters

### T

`T` *extends* [`TransportSnapshot`](/reference/devtools/interfaces/transportsnapshot/)

## Parameters

### snapshot

`T`

## Returns

`object`

### contextUsageRatio

> **contextUsageRatio**: `number` \| `undefined` = `snapshot.contextUsageRatio`

### finalization

> **finalization**: `string` = `snapshot.finalization`

### finalUsageSeconds

> **finalUsageSeconds**: `number` \| `undefined` = `snapshot.finalUsageSeconds`

### generation

> **generation**: `number` = `snapshot.generation`

### playback

> **playback**: `string` = `snapshot.playback`

### sessionId

> **sessionId**: `string` \| `undefined`

### state

> **state**: `string` = `snapshot.state`

### usageSeconds

> **usageSeconds**: `number` \| `undefined` = `snapshot.usageSeconds`
