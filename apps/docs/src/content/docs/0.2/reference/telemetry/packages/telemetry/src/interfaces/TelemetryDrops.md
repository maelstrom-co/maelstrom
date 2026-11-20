---
editUrl: false
next: false
prev: false
title: "TelemetryDrops"
---

Defined in: packages/telemetry/src/types.ts:100

Fixed reasons for lost facts, counted independently of the failing exporter.

## Properties

### disabled

> `readonly` **disabled**: `number`

Defined in: packages/telemetry/src/types.ts:110

New facts refused after an exporter deadline disabled this instance.

***

### disposed

> `readonly` **disposed**: `number`

Defined in: packages/telemetry/src/types.ts:112

Pending records abandoned at disposal, plus new facts refused after disposal.

***

### exportError

> `readonly` **exportError**: `number`

Defined in: packages/telemetry/src/types.ts:106

Records lost when the exporter threw or rejected.

***

### invalid

> `readonly` **invalid**: `number`

Defined in: packages/telemetry/src/types.ts:102

Facts with invalid allowlisted fields; no arbitrary fields are inspected.

***

### overflow

> `readonly` **overflow**: `number`

Defined in: packages/telemetry/src/types.ts:104

New facts refused because queued and exporting records filled the capacity.

***

### timeout

> `readonly` **timeout**: `number`

Defined in: packages/telemetry/src/types.ts:108

Exporting and queued records abandoned when an exporter exceeded its deadline.
