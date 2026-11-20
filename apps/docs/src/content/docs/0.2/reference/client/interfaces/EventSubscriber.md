---
editUrl: false
next: false
prev: false
title: "EventSubscriber"
---

Defined in: packages/client/src/lib/utils/typed-emitter.ts:11

Read-only event subscription interface exposed to consumers.
Prevents consumers from calling emit() or dispose().

## Type Parameters

### T

`T` *extends* [`EventMap`](/reference/client/type-aliases/eventmap/)

## Methods

### off()

> **off**\<`K`\>(`event`, `cb`): `void`

Defined in: packages/client/src/lib/utils/typed-emitter.ts:16

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

***

### on()

> **on**\<`K`\>(`event`, `cb`): () => `void`

Defined in: packages/client/src/lib/utils/typed-emitter.ts:12

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
