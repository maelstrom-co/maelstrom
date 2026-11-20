---
editUrl: false
next: false
prev: false
title: "TypedEmitter"
---

Defined in: packages/client/src/lib/utils/typed-emitter.ts:32

Type-safe event emitter with disposal support.

Uses a mapped type so each event key stores callbacks typed to its
own payload — zero `any`, zero casts.

- Single emit() method: fire-and-forget, synchronous listener invocation.
- After dispose(): emit() silently no-ops, on() throws.
- Async listeners that reject have their errors caught and logged.

Kernels own a TypedEmitter internally and expose it as
EventSubscriber via a public `events` getter.

## Type Parameters

### T

`T` *extends* [`EventMap`](/reference/client/type-aliases/eventmap/)

## Implements

- [`EventSubscriber`](/reference/client/interfaces/eventsubscriber/)\<`T`\>

## Constructors

### Constructor

> **new TypedEmitter**\<`T`\>(): `TypedEmitter`\<`T`\>

#### Returns

`TypedEmitter`\<`T`\>

## Accessors

### disposed

#### Get Signature

> **get** **disposed**(): `boolean`

Defined in: packages/client/src/lib/utils/typed-emitter.ts:87

##### Returns

`boolean`

## Methods

### dispose()

> **dispose**(): `void`

Defined in: packages/client/src/lib/utils/typed-emitter.ts:91

#### Returns

`void`

***

### emit()

> **emit**\<`K`\>(`event`, `payload`): `void`

Defined in: packages/client/src/lib/utils/typed-emitter.ts:67

#### Type Parameters

##### K

`K` *extends* `string`

#### Parameters

##### event

`K`

##### payload

`T`\[`K`\]

#### Returns

`void`

***

### off()

> **off**\<`K`\>(`event`, `cb`): `void`

Defined in: packages/client/src/lib/utils/typed-emitter.ts:63

#### Type Parameters

##### K

`K` *extends* `string`

#### Parameters

##### event

`K`

##### cb

(`payload`) => `void`

#### Returns

`void`

#### Implementation of

[`EventSubscriber`](/reference/client/interfaces/eventsubscriber/).[`off`](/reference/client/interfaces/eventsubscriber/#off)

***

### on()

> **on**\<`K`\>(`event`, `cb`): () => `void`

Defined in: packages/client/src/lib/utils/typed-emitter.ts:44

#### Type Parameters

##### K

`K` *extends* `string`

#### Parameters

##### event

`K`

##### cb

(`payload`) => `void`

#### Returns

() => `void`

#### Implementation of

[`EventSubscriber`](/reference/client/interfaces/eventsubscriber/).[`on`](/reference/client/interfaces/eventsubscriber/#on)
