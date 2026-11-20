---
editUrl: false
next: false
prev: false
title: "attachEngineTelemetry"
---

> **attachEngineTelemetry**(`engine`, `telemetry?`): `TelemetryAttachment`

Defined in: packages/engine/src/lib/telemetry.ts:17

Attaches server-local operational facts in every environment, independently of browser forwarding.
Attach before requests. Repeated attachments share one subscription until the last release.
Release all references and await drained before the final application-owned flush and disposal.
Omitted or disabled telemetry, or an Engine without metadata observation, does not subscribe.

## Parameters

### engine

[`EngineTelemetrySource`](/reference/engine/interfaces/enginetelemetrysource/)

### telemetry?

`Telemetry`

## Returns

`TelemetryAttachment`
