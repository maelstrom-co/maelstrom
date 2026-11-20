---
editUrl: false
next: false
prev: false
title: "TelemetryAttachment"
---

Defined in: packages/telemetry/src/types.ts:177

One reference to a producer subscription with an awaitable shared retirement barrier.

## Properties

### drained

> `readonly` **drained**: `Promise`\<`void`\>

Defined in: packages/telemetry/src/types.ts:181

Completes after the last reference releases and accepted outcomes or source-loss facts are published. Disabled attachments are already drained.

## Methods

### release()

> **release**(): `void`

Defined in: packages/telemetry/src/types.ts:179

Release this reference once. The last release begins retirement of the shared source.

#### Returns

`void`
