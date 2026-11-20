---
editUrl: false
next: false
prev: false
title: "TelemetryOptions"
---

Defined in: packages/telemetry/src/types.ts:140

Explicit queue policy. No sink creates a shared no-op with no retained facts or timers.

## Properties

### batchSize?

> `readonly` `optional` **batchSize?**: `number`

Defined in: packages/telemetry/src/types.ts:146

Maximum records per exporter call, from 1 to capacity. Defaults to min(32, capacity).

***

### capacity?

> `readonly` `optional` **capacity?**: `number`

Defined in: packages/telemetry/src/types.ts:144

Maximum queued plus exporting records, from 1 to 65,536. Defaults to 256.

***

### exportTimeoutMs?

> `readonly` `optional` **exportTimeoutMs?**: `number`

Defined in: packages/telemetry/src/types.ts:148

Exporter deadline, from 1 to 60,000 milliseconds. Defaults to 1,000.

***

### sink?

> `readonly` `optional` **sink?**: [`TelemetrySink`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetrysink/)

Defined in: packages/telemetry/src/types.ts:142

Application-owned exporter; omission disables telemetry in every environment.
