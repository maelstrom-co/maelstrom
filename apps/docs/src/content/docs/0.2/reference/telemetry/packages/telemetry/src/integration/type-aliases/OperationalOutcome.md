---
editUrl: false
next: false
prev: false
title: "OperationalOutcome"
---

> **OperationalOutcome** = [`TelemetryOutcomeDetails`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryoutcomedetails/) & `object`

Defined in: packages/telemetry/src/operational-metadata.ts:10

Terminal evidence with error categories restricted to unsuccessful or unknown work.

## Type Declaration

### outcome

> `readonly` **outcome**: `"succeeded"` \| `"failed"` \| `"cancelled"` \| `"skipped"` \| `"unknown"`

Result established by the producer, independent of transport acknowledgement.
