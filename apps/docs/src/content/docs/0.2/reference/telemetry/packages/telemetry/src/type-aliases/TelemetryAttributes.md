---
editUrl: false
next: false
prev: false
title: "TelemetryAttributes"
---

> **TelemetryAttributes** = [`TelemetryOutcomeDetails`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryoutcomedetails/) & `object`

Defined in: packages/telemetry/src/types.ts:40

The complete metric dimension allowlist. Identifiers and content have no representation here.

## Type Declaration

### layoutMode?

> `readonly` `optional` **layoutMode?**: *typeof* `telemetryLayoutModes`\[`number`\]

Layout algorithm, when the producer knows it.

### operation

> `readonly` **operation**: [`TelemetryOperation`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryoperation/)

Unit of work whose evidence was observed.

### provider?

> `readonly` `optional` **provider?**: [`TelemetryProvider`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryprovider/)

Optional application-selected provider category; omission means unknown.
