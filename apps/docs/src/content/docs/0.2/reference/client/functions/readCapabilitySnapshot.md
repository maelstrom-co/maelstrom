---
editUrl: false
next: false
prev: false
title: "readCapabilitySnapshot"
---

> **readCapabilitySnapshot**(`vessels`): [`CapabilitySnapshotProjection`](/reference/client/interfaces/capabilitysnapshotprojection/)

Defined in: packages/client/src/lib/voice-session/capability-snapshot.ts:208

Pure projection from the registered vessels to a conversational capability
catalog, alongside the record of every declared enum value the projection
could not carry into it.

Nothing is logged here — the omissions are returned so the projection stays
pure and callers choose how to surface them. Most callers want
`Orchestrator.getCapabilitySnapshot()`, which unwraps the snapshot and
reports the omissions through the orchestrator's logger.

## Parameters

### vessels

readonly `object`[]

## Returns

[`CapabilitySnapshotProjection`](/reference/client/interfaces/capabilitysnapshotprojection/)

## Example

```ts
const { snapshot, optionOmissions } = readCapabilitySnapshot(vessels);
if (optionOmissions.length > 0) {
  console.warn('some declared option values never reached the model', optionOmissions);
}
```
