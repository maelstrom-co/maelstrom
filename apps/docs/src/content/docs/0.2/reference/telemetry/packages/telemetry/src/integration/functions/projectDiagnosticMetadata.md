---
editUrl: false
next: false
prev: false
title: "projectDiagnosticMetadata"
---

> **projectDiagnosticMetadata**(`kind`, `metadata`, `provider?`): [`TelemetryFact`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryfact/) \| `undefined`

Defined in: packages/telemetry/src/diagnostic-metadata.ts:66

Projects an explicit allowlist of existing producer metadata to the operational contract.
Pass only kind and metadata: this API accepts no diagnostic envelope, content reader,
identifiers, timestamps, or raw provider frames. Unknown kinds return undefined.
Provider category comes from application configuration, never a free-text diagnostic label.
Missing or invalid durations remain unknown. This function does not subscribe to sources.

## Parameters

### kind

`string`

### metadata

`Readonly`\<`Record`\<`string`, `unknown`\>\>

### provider?

`"openai-live"` \| `"openai-realtime"` \| `"livekit"` \| `"custom"`

## Returns

[`TelemetryFact`](/reference/telemetry/packages/telemetry/src/type-aliases/telemetryfact/) \| `undefined`
