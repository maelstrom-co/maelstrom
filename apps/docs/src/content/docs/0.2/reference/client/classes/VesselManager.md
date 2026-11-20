---
editUrl: false
next: false
prev: false
title: "VesselManager"
---

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:57

Manages vessel registration, lookup, and lifecycle events.

Creates and owns its own store. Every vessel passes through
`validateVessel` so all stored entries carry post-transform brands
for IDs, variant names, and action names. Invalid input is rejected:
`registerVessel` returns `{ valid: false, issues }` and does not
mutate state or emit `vessel_registered`.

## Example

```ts
const manager = new VesselManager({ debug: true });

manager.events.on('vessel_registered', (e) => {
  console.log(`Registered: ${e.vessel.id}`);
});

const result = manager.registerVessel(myVessel);
if (!result.valid) {
  console.error(result.issues);
}
```

## Constructors

### Constructor

> **new VesselManager**(`options?`): `VesselManager`

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:63

#### Parameters

##### options?

[`VesselManagerOptions`](/reference/client/interfaces/vesselmanageroptions/) = `{}`

#### Returns

`VesselManager`

## Properties

### events

> `readonly` **events**: [`EventSubscriber`](/reference/client/interfaces/eventsubscriber/)\<[`VesselManagerEvents`](/reference/client/type-aliases/vesselmanagerevents/)\>

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:60

***

### store

> `readonly` **store**: `Store`\<[`VesselManagerState`](/reference/client/type-aliases/vesselmanagerstate/)\>

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:58

## Accessors

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:150

##### Returns

`number`

## Methods

### dispose()

> **dispose**(): `void`

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:158

#### Returns

`void`

***

### get()

> **get**(`vesselId`): \{ `defaultVariant`: `VariantName`; `description`: `string`; `id`: `VesselId`; `name`: `string`; `variants`: `z.ZodRecord`\<`z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<`VariantName`, `string`\>\>, `z.ZodObject`\<\{ `actions`: `z.ZodArray`\<`z.ZodObject`\<\{ `description`: `z.ZodString`; `idempotent`: `z.ZodDefault`\<`z.ZodOptional`\<`z.ZodBoolean`\>\>; `name`: `z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<`ActionName`, `string`\>\>; `parameters`: `z.ZodOptional`\<`z.ZodArray`\<`z.ZodObject`\<..., ...\>\>\>; `transitionsTo`: `z.ZodOptional`\<`z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<..., ...\>\>\>; \}, `z.core.$strip`\>\>; `description`: `z.ZodOptional`\<`z.ZodString`\>; `minSize`: `z.ZodObject`\<\{ `height`: `z.ZodNumber`; `width`: `z.ZodNumber`; \}, `z.core.$strip`\>; `props`: `z.ZodRecord`\<`z.ZodString`, `z.ZodUnknown`\>; \}, `z.core.$strip`\>\>; \} \| `undefined`

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:138

#### Parameters

##### vesselId

`string`

#### Returns

\{ `defaultVariant`: `VariantName`; `description`: `string`; `id`: `VesselId`; `name`: `string`; `variants`: `z.ZodRecord`\<`z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<`VariantName`, `string`\>\>, `z.ZodObject`\<\{ `actions`: `z.ZodArray`\<`z.ZodObject`\<\{ `description`: `z.ZodString`; `idempotent`: `z.ZodDefault`\<`z.ZodOptional`\<`z.ZodBoolean`\>\>; `name`: `z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<`ActionName`, `string`\>\>; `parameters`: `z.ZodOptional`\<`z.ZodArray`\<`z.ZodObject`\<..., ...\>\>\>; `transitionsTo`: `z.ZodOptional`\<`z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<..., ...\>\>\>; \}, `z.core.$strip`\>\>; `description`: `z.ZodOptional`\<`z.ZodString`\>; `minSize`: `z.ZodObject`\<\{ `height`: `z.ZodNumber`; `width`: `z.ZodNumber`; \}, `z.core.$strip`\>; `props`: `z.ZodRecord`\<`z.ZodString`, `z.ZodUnknown`\>; \}, `z.core.$strip`\>\>; \} \| `undefined`

***

### getAll()

> **getAll**(): `object`[]

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:142

#### Returns

`object`[]

***

### getRegisteredIds()

> **getRegisteredIds**(): `string`[]

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:154

#### Returns

`string`[]

***

### has()

> **has**(`vesselId`): `boolean`

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:146

#### Parameters

##### vesselId

`string`

#### Returns

`boolean`

***

### registerVessel()

> **registerVessel**(`vessel`): `VesselValidationResult`

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:78

Registers a vessel. Always validates through the schema; on failure,
returns the validation result without mutating state. Overwrites
any existing vessel with the same ID.

#### Parameters

##### vessel

`VesselDefinition`

#### Returns

`VesselValidationResult`

***

### unregisterVessel()

> **unregisterVessel**(`vesselId`): \{ `defaultVariant`: `VariantName`; `description`: `string`; `id`: `VesselId`; `name`: `string`; `variants`: `z.ZodRecord`\<`z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<`VariantName`, `string`\>\>, `z.ZodObject`\<\{ `actions`: `z.ZodArray`\<`z.ZodObject`\<\{ `description`: `z.ZodString`; `idempotent`: `z.ZodDefault`\<`z.ZodOptional`\<`z.ZodBoolean`\>\>; `name`: `z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<`ActionName`, `string`\>\>; `parameters`: `z.ZodOptional`\<`z.ZodArray`\<`z.ZodObject`\<..., ...\>\>\>; `transitionsTo`: `z.ZodOptional`\<`z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<..., ...\>\>\>; \}, `z.core.$strip`\>\>; `description`: `z.ZodOptional`\<`z.ZodString`\>; `minSize`: `z.ZodObject`\<\{ `height`: `z.ZodNumber`; `width`: `z.ZodNumber`; \}, `z.core.$strip`\>; `props`: `z.ZodRecord`\<`z.ZodString`, `z.ZodUnknown`\>; \}, `z.core.$strip`\>\>; \} \| `undefined`

Defined in: packages/client/src/lib/vessel-management/vessel-manager.ts:113

Unregisters a vessel by ID. Returns the removed vessel, or undefined.

#### Parameters

##### vesselId

`string`

#### Returns

\{ `defaultVariant`: `VariantName`; `description`: `string`; `id`: `VesselId`; `name`: `string`; `variants`: `z.ZodRecord`\<`z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<`VariantName`, `string`\>\>, `z.ZodObject`\<\{ `actions`: `z.ZodArray`\<`z.ZodObject`\<\{ `description`: `z.ZodString`; `idempotent`: `z.ZodDefault`\<`z.ZodOptional`\<`z.ZodBoolean`\>\>; `name`: `z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<`ActionName`, `string`\>\>; `parameters`: `z.ZodOptional`\<`z.ZodArray`\<`z.ZodObject`\<..., ...\>\>\>; `transitionsTo`: `z.ZodOptional`\<`z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<..., ...\>\>\>; \}, `z.core.$strip`\>\>; `description`: `z.ZodOptional`\<`z.ZodString`\>; `minSize`: `z.ZodObject`\<\{ `height`: `z.ZodNumber`; `width`: `z.ZodNumber`; \}, `z.core.$strip`\>; `props`: `z.ZodRecord`\<`z.ZodString`, `z.ZodUnknown`\>; \}, `z.core.$strip`\>\>; \} \| `undefined`
