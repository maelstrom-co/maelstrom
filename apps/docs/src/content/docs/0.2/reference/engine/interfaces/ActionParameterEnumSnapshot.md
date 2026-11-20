---
editUrl: false
next: false
prev: false
title: "ActionParameterEnumSnapshot"
---

Defined in: packages/engine/src/lib/action-parameter-enum.ts:20

Immutable, request-scoped enum candidates keyed by parameter definition
object. Read it with `enumSnapshotFor(ctx, vessels)`, which returns it only
when `vessels` is the catalog it was captured from.

## Methods

### get()

> **get**(`parameter`): readonly [`NormalizedActionParameterEnumValue`](/reference/engine/interfaces/normalizedactionparameterenumvalue/)[]

Defined in: packages/engine/src/lib/action-parameter-enum.ts:26

Returns the normalized candidates captured for this exact parameter
definition. An empty result means the parameter has no constraining,
type-compatible JSON enum values.

#### Parameters

##### parameter

###### defaultValue?

`unknown`

###### description

`string`

###### enum?

`unknown`[]

###### name

`string`

###### required?

`boolean`

###### type

`"string"` \| `"number"` \| `"boolean"` \| `"object"`

#### Returns

readonly [`NormalizedActionParameterEnumValue`](/reference/engine/interfaces/normalizedactionparameterenumvalue/)[]
