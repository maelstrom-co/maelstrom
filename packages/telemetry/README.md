# @maelstrom-co/telemetry

Provider-neutral telemetry contracts for Maelstrom.

This package defines the small shared contract that Maelstrom packages can emit against. It gives you typed event, metric, and timing payloads, a synchronous sink interface, a reusable no-op sink, curated `maelstrom.*` names, and privacy helpers for default-safe attributes.

## What this package does

- Defines provider-neutral telemetry primitives.
- Exposes a synchronous `TelemetrySink` contract with no-op helpers.
- Publishes a small curated Maelstrom vocabulary.
- Publishes privacy metadata and helper predicates for default attribute decisions.

## What this package does not do

- It is not a telemetry SDK.
- It does not start exporters, collectors, queues, retries, or shutdown hooks.
- It does not add instrumentation to Maelstrom packages for you.
- It does not sanitize arbitrary user content into safe telemetry.
- It does not choose or configure your backend.

## Install

```bash
bun add @maelstrom-co/telemetry
```

## Quick start

```ts
import {
  emitTelemetryEvent,
  isDefaultTelemetryAttributeAllowed,
  maelstromTelemetryAttributes,
  noopTelemetrySink,
  type TelemetrySink,
} from '@maelstrom-co/telemetry';

const sink: TelemetrySink = noopTelemetrySink;

emitTelemetryEvent(sink, {
  name: 'maelstrom.telemetry.event',
  severity: 'info',
  attributes: {
    [maelstromTelemetryAttributes['maelstrom.package'].name]: '@maelstrom-co/client',
    [maelstromTelemetryAttributes['maelstrom.layout_mode'].name]: 'grid',
  },
});

isDefaultTelemetryAttributeAllowed('maelstrom.layout_mode');
// true

isDefaultTelemetryAttributeAllowed('sessionId');
// false
```

## No-op behavior

`noopTelemetrySink` ignores every payload and returns `undefined` from each method. The optional helpers follow the same rule when `sink` is `undefined`.

```ts
import { emitTelemetryEvent } from '@maelstrom-co/telemetry';

emitTelemetryEvent(undefined, {
  name: 'maelstrom.telemetry.event',
});
// returns undefined and does nothing
```

This makes telemetry calls safe in shared libraries that want a stable contract without forcing every caller to branch on sink presence.

## Sync-only sink semantics

`TelemetrySink` methods are synchronous and return `void`.

- Callers hand off a payload and continue.
- This package does not expose async flush, batching, retry, or lifecycle APIs.
- Any buffering or export work belongs in an adapter that sits behind the sink.

## Privacy helpers

The privacy surface is conservative by default.

- Known sensitive fields such as `sessionId`, `requestId`, `prompt`, `text`, and `audio` are excluded from default telemetry.
- Unknown fields are also excluded by default.
- Curated low-cardinality fields such as `maelstrom.layout_mode` and `maelstrom.outcome` are allowed.

```ts
import {
  isDefaultTelemetryAttributeAllowed,
  isSensitiveTelemetryField,
  sensitiveTelemetryFields,
} from '@maelstrom-co/telemetry';

isSensitiveTelemetryField('prompt');
// true

isDefaultTelemetryAttributeAllowed('prompt');
// false

sensitiveTelemetryFields.sessionId.reason;
// "Raw session identifiers must not be emitted as default telemetry attributes."
```

## Curated vocabulary

The package ships a small `maelstrom.*` catalog for names that are safe to share across packages.

- `maelstromTelemetryAttributes`
- `maelstromTelemetryEvents`
- `maelstromTelemetryMetrics`

Metric and timing units live in metadata, not in the metric name. For example, `maelstrom.operation.duration` carries `unit: 'ms'` in metadata instead of encoding the unit in the name.

## OpenTelemetry and other adapters

This package does not depend on OpenTelemetry.

Use it as the contract at package boundaries, then translate those payloads in an application-owned adapter. That adapter can map `TelemetryEvent`, `TelemetryMetric`, and `TelemetryTiming` into OpenTelemetry, a vendor SDK, logs, or another backend.

In short:

- `@maelstrom-co/telemetry` owns the contract.
- Your application owns the adapter.
- The backend choice stays outside this package.
