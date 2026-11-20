---
editUrl: false
next: false
prev: false
title: "attachClientTelemetry"
---

> **attachClientTelemetry**(`orchestrator`, `telemetry?`): `TelemetryAttachment`

Defined in: packages/client/src/lib/telemetry.ts:17

Attaches local client operational facts without enabling remote diagnostics or content capture.
Attach before connecting. Repeated attachments share one subscription until the last release.
Release all references and await drained before the final application-owned flush and disposal.
Omitted or disabled telemetry does not subscribe.

## Parameters

### orchestrator

[`ClientTelemetrySource`](/reference/client/interfaces/clienttelemetrysource/)

### telemetry?

`Telemetry`

## Returns

`TelemetryAttachment`
