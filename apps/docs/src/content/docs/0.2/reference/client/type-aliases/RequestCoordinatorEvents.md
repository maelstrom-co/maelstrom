---
editUrl: false
next: false
prev: false
title: "RequestCoordinatorEvents"
---

> **RequestCoordinatorEvents** = `object`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:35

Event payloads emitted by RequestCoordinator.

## Properties

### error

> **error**: `object`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:47

A live request failed before transport completion.

#### durationMs

> **durationMs**: `number`

Local elapsed request duration.

#### error

> **error**: `Error`

Original transport failure.

#### requestId

> **requestId**: [`MessageId`](/reference/client/type-aliases/messageid/)

Failed request identity.

#### timestamp

> **timestamp**: `number`

Local monotonic error time.

***

### processing\_completed

> **processing\_completed**: `object`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:41

Transport receipt, independent of client application outcome.

#### durationMs

> **durationMs**: `number`

Local round-trip duration.

#### requestId

> **requestId**: [`MessageId`](/reference/client/type-aliases/messageid/)

Correlation identity from the request envelope.

#### response

> **response**: `MaelstromResponse`

Received Engine decision.

#### timestamp

> **timestamp**: `number`

Local monotonic receipt time.

***

### processing\_started

> **processing\_started**: `object`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:36

A transport-independent request begins.

#### message

> **message**: `ChartRequestMessage`

Request content; diagnostic consumers retain it only during explicit capture.

#### requestId

> **requestId**: [`MessageId`](/reference/client/type-aliases/messageid/)

Correlation identity from the request envelope.

#### timestamp

> **timestamp**: `number`

Local monotonic start time.
