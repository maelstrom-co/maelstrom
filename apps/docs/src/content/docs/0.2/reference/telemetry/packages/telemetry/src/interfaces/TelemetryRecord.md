---
editUrl: false
next: false
prev: false
title: "TelemetryRecord"
---

Defined in: packages/telemetry/src/types.ts:79

Immutable, content-free export record for one accepted fact.

## Properties

### attributes

> `readonly` **attributes**: [`TelemetryAttributes`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryattributes/)

Defined in: packages/telemetry/src/types.ts:81

Fixed dimension allowlist shared by this record's measurements.

***

### measurements

> `readonly` **measurements**: readonly [`TelemetryMeasurement`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetrymeasurement/)[]

Defined in: packages/telemetry/src/types.ts:83

One counter and, when known, one local duration histogram observation.
