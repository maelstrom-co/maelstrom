---
editUrl: false
next: false
prev: false
title: "RetainedLiveTransport"
---

Defined in: packages/devtools/src/voice-diagnostics.ts:29

Terminal transport facts retained without provider configuration.

## Extends

- `ReturnType`\<*typeof* [`projectLiveTransport`](/reference/devtools/functions/projectlivetransport/)\>

## Properties

### backendModel

> `readonly` **backendModel**: `string`

Defined in: packages/devtools/src/voice-diagnostics.ts:38

Configured managed model.

***

### contextUsageRatio

> **contextUsageRatio**: `number` \| `undefined` = `snapshot.contextUsageRatio`

Defined in: packages/devtools/src/voice-diagnostics.ts:250

#### Inherited from

`ReturnType.contextUsageRatio`

***

### finalization

> **finalization**: `string` = `snapshot.finalization`

Defined in: packages/devtools/src/voice-diagnostics.ts:251

#### Inherited from

`ReturnType.finalization`

***

### finalUsageSeconds

> **finalUsageSeconds**: `number` \| `undefined` = `snapshot.finalUsageSeconds`

Defined in: packages/devtools/src/voice-diagnostics.ts:249

#### Inherited from

`ReturnType.finalUsageSeconds`

***

### generation

> **generation**: `number` = `snapshot.generation`

Defined in: packages/devtools/src/voice-diagnostics.ts:246

#### Inherited from

`ReturnType.generation`

***

### model

> `readonly` **model**: `string`

Defined in: packages/devtools/src/voice-diagnostics.ts:36

Configured voice model, not a provider-confirmed claim.

***

### observedAt

> `readonly` **observedAt**: `number`

Defined in: packages/devtools/src/voice-diagnostics.ts:40

Browser receipt time in milliseconds.

***

### playback

> **playback**: `string` = `snapshot.playback`

Defined in: packages/devtools/src/voice-diagnostics.ts:252

#### Inherited from

`ReturnType.playback`

***

### provider

> `readonly` **provider**: `"live"`

Defined in: packages/devtools/src/voice-diagnostics.ts:32

Application provider label.

***

### providerInstanceId

> `readonly` **providerInstanceId**: `string`

Defined in: packages/devtools/src/voice-diagnostics.ts:34

Unique provider lifetime identity.

***

### sessionId

> **sessionId**: `string` \| `undefined`

Defined in: packages/devtools/src/voice-diagnostics.ts:245

#### Inherited from

`ReturnType.sessionId`

***

### state

> **state**: `string` = `snapshot.state`

Defined in: packages/devtools/src/voice-diagnostics.ts:247

#### Inherited from

`ReturnType.state`

***

### usageSeconds

> **usageSeconds**: `number` \| `undefined` = `snapshot.usageSeconds`

Defined in: packages/devtools/src/voice-diagnostics.ts:248

#### Inherited from

`ReturnType.usageSeconds`
