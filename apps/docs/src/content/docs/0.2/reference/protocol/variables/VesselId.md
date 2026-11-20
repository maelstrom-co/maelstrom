---
editUrl: false
next: false
prev: false
title: "VesselId"
---

> **VesselId**: (`value`) => [`VesselId`](/reference/protocol/type-aliases/vesselid/)

Defined in: packages/protocol/src/lib/vessel-id.ts:10

Brands a string as a VesselId without changing its value.

No auto-gen path — VesselIds always originate from a vessel definition
(developer-authored) or from LLM output that references one.

## Parameters

### value

`string`

## Returns

[`VesselId`](/reference/protocol/type-aliases/vesselid/)

## Example

```ts
const id = VesselId('calendar');
const registry = new Map<VesselId, Vessel>();
```
