---
editUrl: false
next: false
prev: false
title: "createTelemetry"
---

> **createTelemetry**(`options?`): [`Telemetry`](/reference/telemetry/packages/telemetry/src/interfaces/telemetry/)

Defined in: packages/telemetry/src/telemetry.ts:83

Creates isolated, bounded operational delivery in any environment.
No sink returns [noopTelemetry](/reference/telemetry/packages/telemetry/src/variables/nooptelemetry/). Export calls run outside record's call stack.
Rejected batches drop without retry. A deadline disables the instance to avoid
accumulating exporter work that JavaScript cannot forcibly cancel.

## Parameters

### options?

[`TelemetryOptions`](/reference/telemetry/packages/telemetry/src/interfaces/telemetryoptions/) = `{}`

## Returns

[`Telemetry`](/reference/telemetry/packages/telemetry/src/interfaces/telemetry/)

## Throws

If enabled queue or deadline options are outside their documented bounds.
