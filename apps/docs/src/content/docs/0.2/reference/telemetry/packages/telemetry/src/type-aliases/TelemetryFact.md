---
editUrl: false
next: false
prev: false
title: "TelemetryFact"
---

> **TelemetryFact** = [`TelemetryAttributes`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryattributes/) & `object`

Defined in: packages/telemetry/src/types.ts:50

One producer fact. Extra runtime fields are discarded before queueing or sink delivery.

## Type Declaration

### durationMs?

> `readonly` `optional` **durationMs?**: `number`

Nonnegative duration measured within one process; omission preserves unknown timing.
