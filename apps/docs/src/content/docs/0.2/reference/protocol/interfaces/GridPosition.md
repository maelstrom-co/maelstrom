---
editUrl: false
next: false
prev: false
title: "GridPosition"
---

Defined in: packages/protocol/src/lib/response.ts:36

Grid allocation that resolves an Instance from retained client state.

## Properties

### instanceId

> `readonly` **instanceId**: [`InstanceId`](/reference/protocol/type-aliases/instanceid/)

Defined in: packages/protocol/src/lib/response.ts:38

Unknown IDs cannot create grid Instances and are dropped by layout application.

***

### position

> `readonly` **position**: `object`

Defined in: packages/protocol/src/lib/response.ts:40

Model schemas reject fractions and negatives; Engine healing enforces bounds.

#### column

> `readonly` **column**: `number`

#### row

> `readonly` **row**: `number`

***

### size

> `readonly` **size**: `object`

Defined in: packages/protocol/src/lib/response.ts:42

Engine healing enforces Chart bounds and the Variant minimum size.

#### height

> `readonly` **height**: `number`

#### width

> `readonly` **width**: `number`
