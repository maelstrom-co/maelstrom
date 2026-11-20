---
editUrl: false
next: false
prev: false
title: "DynamicVesselHandle"
---

Defined in: packages/react/src/lib/dynamic-vessel-types.ts:28

Handle returned by `m.registerVessel()` for dynamically registered vessels.
Provides typed hooks scoped to the registered vessel and a cleanup method.

## Type Parameters

### V

`V` *extends* `VesselDefinition`

## Properties

### unregister

> **unregister**: () => `void`

Defined in: packages/react/src/lib/dynamic-vessel-types.ts:66

Remove vessel from all registries (vesselManager, componentMap, loadingMap)

#### Returns

`void`

***

### update

> **update**: (`definition`) => [`UpdateVesselResult`](/reference/react/type-aliases/updatevesselresult/)

Defined in: packages/react/src/lib/dynamic-vessel-types.ts:64

Republish this vessel's definition — its description, variants, and
action parameters — without touching its component registration, so the
vessel does not remount and keeps any DOM/canvas state it owns.

This is the runtime-registration counterpart to `m.updateVessel()`: a
vessel registered via `registerVessel()` never appears in the factory's
`vessels` tuple, so `m.updateVessel()` cannot name its id at the type
level. `handle.update()` closes that gap — `V` is exactly the
definition inferred at the `registerVessel()` call site, fixed at
compile time, so `definition` is checked against it the same way
`m.updateVessel()` checks a factory-declared vessel's payload against
the entry passed to `createMaelstrom({ vessels })`.

Enforces the same runtime guards as `m.updateVessel()`: throws a plain
`Error` if no Provider is mounted, the vessel id is not registered, or
the definition fails validation. Returns `{ ok: false, conflict }`
instead of throwing if a live instance's current variant is missing
from the new definition (`'variant_dropped'`), if the new definition
drops an action that instance's variant still declares
(`'action_dropped'`), or if a command batch is already queued or in
flight (`'batch_in_flight'`) — see `m.updateVessel()`'s JSDoc for the
full result contract.

#### Parameters

##### definition

[`RepublishableVessel`](/reference/react/type-aliases/republishablevessel/)\<`V`\>

#### Returns

[`UpdateVesselResult`](/reference/react/type-aliases/updatevesselresult/)

#### Example

```ts
const handle = m.registerVessel(widgetEntry);
const result = handle.update({ ...widgetEntry.vessel, description: 'Updated widget' });
if (!result.ok) {
  console.warn(result.conflict.message);
}
```

***

### useActions

> **useActions**: (`instanceId`, `runner`) => `void`

Defined in: packages/react/src/lib/dynamic-vessel-types.ts:32

Typed action runner registration — equivalent to `m.useActions(vesselId, instanceId, runner)` but pre-scoped

#### Parameters

##### instanceId

`string`

##### runner

[`ActionRunner`](/reference/react/type-aliases/actionrunner/)\<`V`\>

#### Returns

`void`

***

### useVessel

> **useVessel**: (`instanceId`) => [`TypedVesselProps`](/reference/react/interfaces/typedvesselprops/)\<`V`\> \| `null`

Defined in: packages/react/src/lib/dynamic-vessel-types.ts:30

Typed vessel props hook — equivalent to `m.useVessel(vesselId, instanceId)` but pre-scoped

#### Parameters

##### instanceId

`string`

#### Returns

[`TypedVesselProps`](/reference/react/interfaces/typedvesselprops/)\<`V`\> \| `null`
