---
editUrl: false
next: false
prev: false
title: "TelemetrySnapshot"
---

Defined in: packages/telemetry/src/types.ts:116

Local delivery accounting. A successful exporter call does not prove backend persistence.

## Properties

### accepted

> `readonly` **accepted**: `number`

Defined in: packages/telemetry/src/types.ts:120

Total facts accepted into the bounded queue.

***

### delivered

> `readonly` **delivered**: `number`

Defined in: packages/telemetry/src/types.ts:122

Records acknowledged by a fulfilled exporter call.

***

### dropped

> `readonly` **dropped**: [`TelemetryDrops`](/reference/telemetry/packages/telemetry/src/interfaces/telemetrydrops/)

Defined in: packages/telemetry/src/types.ts:128

Cumulative local loss counters; no network is used to report them.

***

### exporting

> `readonly` **exporting**: `number`

Defined in: packages/telemetry/src/types.ts:126

Records held by the one active exporter call.

***

### queued

> `readonly` **queued**: `number`

Defined in: packages/telemetry/src/types.ts:124

Records waiting for the single exporter slot.

***

### state

> `readonly` **state**: `"active"` \| `"disabled"` \| `"timed_out"` \| `"disposed"`

Defined in: packages/telemetry/src/types.ts:118

Timed-out instances stay disabled; create a new instance to attach a replacement sink.
