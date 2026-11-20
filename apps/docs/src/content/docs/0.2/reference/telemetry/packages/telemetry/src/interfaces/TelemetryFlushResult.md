---
editUrl: false
next: false
prev: false
title: "TelemetryFlushResult"
---

Defined in: packages/telemetry/src/types.ts:132

Result for the facts accepted before a flush began; later arrivals cannot extend its barrier.

## Properties

### outcome

> `readonly` **outcome**: `"disabled"` \| `"disposed"` \| `"settled"` \| `"deadline_exceeded"`

Defined in: packages/telemetry/src/types.ts:134

Settled includes exporter rejection; inspect delivery and loss counts.

***

### snapshot

> `readonly` **snapshot**: [`TelemetrySnapshot`](/reference/telemetry/packages/telemetry/src/interfaces/telemetrysnapshot/)

Defined in: packages/telemetry/src/types.ts:136

Delivery accounting when this flush completed.
