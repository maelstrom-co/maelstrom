---
editUrl: false
next: false
prev: false
title: "VesselManagerState"
---

> **VesselManagerState** = `object`

Defined in: packages/client/src/lib/vessel-management/vessel-manager.state.ts:4

Registry state whose registrations are validated; caller-supplied initial state is trusted.

## Properties

### vessels

> **vessels**: `Map`\<`VesselId`, `Vessel`\>

Defined in: packages/client/src/lib/vessel-management/vessel-manager.state.ts:6

Successful registration replaces any Vessel with the same identity.
