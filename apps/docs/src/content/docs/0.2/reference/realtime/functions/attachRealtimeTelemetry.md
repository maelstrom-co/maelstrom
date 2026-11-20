---
editUrl: false
next: false
prev: false
title: "attachRealtimeTelemetry"
---

> **attachRealtimeTelemetry**(`__namedParameters`): `TelemetryAttachment`

Defined in: packages/realtime/src/lib/diagnostics.ts:71

Attaches content-free voice operational facts in every environment.
Repeated attachments share a subscription and drain promise until the last release.
Release all references, await drained, then flush and dispose application-owned telemetry.
Omitted or disabled telemetry ignores limits and creates no subscription.

## Parameters

### \_\_namedParameters

[`RealtimeTelemetryAttachment`](/reference/realtime/interfaces/realtimetelemetryattachment/)

## Returns

`TelemetryAttachment`

## Throws

If enabled limits are invalid or an existing attachment uses a different category or policy.
