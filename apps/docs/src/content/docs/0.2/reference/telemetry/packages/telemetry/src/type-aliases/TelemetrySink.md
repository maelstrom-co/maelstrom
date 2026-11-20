---
editUrl: false
next: false
prev: false
title: "TelemetrySink"
---

> **TelemetrySink** = (`batch`, `signal`) => `void` \| `PromiseLike`\<`void`\>

Defined in: packages/telemetry/src/types.ts:94

Application-owned batch exporter. Initialize SDKs and network destinations outside libraries.
Fulfillment acknowledges batch acceptance; throws and rejections drop it without retry.
HTTP exporters must check response status and throw for unsuccessful responses.
Await only work bounded by exportTimeoutMs, or acknowledge acceptance into an application-owned queue.
The signal carries a TimeoutError on the fatal exporter deadline or an AbortError on disposal.
Exporters must cooperate to stop external work; inspect snapshot.state to detect timed_out delivery.

## Parameters

### batch

readonly [`TelemetryRecord`](/reference/telemetry/packages/telemetry/src/interfaces/telemetryrecord/)[]

### signal

`AbortSignal`

## Returns

`void` \| `PromiseLike`\<`void`\>
