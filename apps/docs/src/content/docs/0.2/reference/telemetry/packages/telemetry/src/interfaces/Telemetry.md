---
editUrl: false
next: false
prev: false
title: "Telemetry"
---

Defined in: packages/telemetry/src/types.ts:152

Per-application telemetry lifetime, independent of DevTools, recordings, and remote forwarding.

## Properties

### enabled

> `readonly` **enabled**: `boolean`

Defined in: packages/telemetry/src/types.ts:154

Whether this instance currently accepts facts.

## Methods

### dispose()

> **dispose**(): `void`

Defined in: packages/telemetry/src/types.ts:167

Abort delivery and drop pending records immediately. Flush first when delivery matters.

#### Returns

`void`

***

### flush()

> **flush**(`timeoutMs?`): `Promise`\<[`TelemetryFlushResult`](/reference/telemetry/packages/telemetry/src/interfaces/telemetryflushresult/)\>

Defined in: packages/telemetry/src/types.ts:165

Wait for previously accepted facts to settle. The default deadline is 1,000 milliseconds.
A flush deadline leaves export work running; an exporter deadline disables delivery.
Do not await this method from inside the sink that it is waiting for.

#### Parameters

##### timeoutMs?

`number`

#### Returns

`Promise`\<[`TelemetryFlushResult`](/reference/telemetry/packages/telemetry/src/interfaces/telemetryflushresult/)\>

#### Throws

If timeoutMs is not an integer from 1 to 60,000 on an enabled instance.

***

### getSnapshot()

> **getSnapshot**(): [`TelemetrySnapshot`](/reference/telemetry/packages/telemetry/src/interfaces/telemetrysnapshot/)

Defined in: packages/telemetry/src/types.ts:158

Read local counters without exporting or exposing application content.

#### Returns

[`TelemetrySnapshot`](/reference/telemetry/packages/telemetry/src/interfaces/telemetrysnapshot/)

***

### record()

> **record**(`fact`): `void`

Defined in: packages/telemetry/src/types.ts:156

Validate and enqueue one fact without invoking or waiting for the exporter.

#### Parameters

##### fact

[`TelemetryFact`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryfact/)

#### Returns

`void`
