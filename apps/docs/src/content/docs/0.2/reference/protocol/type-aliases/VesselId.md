---
editUrl: false
next: false
prev: false
title: "VesselId"
---

> **VesselId** = [`Brand`](/reference/protocol/type-aliases/brand/)\<`string`, `"VesselId"`\>

Defined in: packages/protocol/src/lib/vessel-id.ts:10

Opaque identifier for a vessel definition.

Distinct from [InstanceId](/reference/protocol/type-aliases/instanceid/): a `VesselId` names the *type* of vessel
(e.g. `"calendar"`, `"orders"`) — many `InstanceId`s may share one
`VesselId`. Always originates from a registered vessel definition.
