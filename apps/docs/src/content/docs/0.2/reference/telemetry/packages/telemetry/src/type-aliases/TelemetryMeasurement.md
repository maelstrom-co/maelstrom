---
editUrl: false
next: false
prev: false
title: "TelemetryMeasurement"
---

> **TelemetryMeasurement** = \{ `name`: `"maelstrom.operation.count"`; `type`: `"counter"`; `unit`: `"{operation}"`; `value`: `1`; \} \| \{ `name`: `"maelstrom.operation.duration"`; `type`: `"histogram"`; `unit`: `"ms"`; `value`: `number`; \}

Defined in: packages/telemetry/src/types.ts:56

Measurements exported independently of any downstream detailed trace sampling.

## Union Members

### Type Literal

\{ `name`: `"maelstrom.operation.count"`; `type`: `"counter"`; `unit`: `"{operation}"`; `value`: `1`; \}

#### name

> `readonly` **name**: `"maelstrom.operation.count"`

Stable instrument name. Count started and terminal outcomes separately.

#### type

> `readonly` **type**: `"counter"`

Add this observation to the operation count.

#### unit

> `readonly` **unit**: `"{operation}"`

One observed operation phase.

#### value

> `readonly` **value**: `1`

Each accepted fact contributes exactly one observation.

***

### Type Literal

\{ `name`: `"maelstrom.operation.duration"`; `type`: `"histogram"`; `unit`: `"ms"`; `value`: `number`; \}

#### name

> `readonly` **name**: `"maelstrom.operation.duration"`

Stable instrument name; never sum nested stage durations as request latency.

#### type

> `readonly` **type**: `"histogram"`

Record the local duration distribution.

#### unit

> `readonly` **unit**: `"ms"`

Milliseconds on the producer's own clock.

#### value

> `readonly` **value**: `number`

Finite, nonnegative local duration.
