---
editUrl: false
next: false
prev: false
title: "ChartManager"
---

Defined in: packages/client/src/lib/chart-manager/chart-manager.ts:44

Manages chart dimensions and resize coordination.

Creates and owns its own store. Tracks the current chart dimensions
and buffers pending resize update reasons for the orchestrator to consume.

## Example

```ts
const manager = new ChartManager();

manager.events.on('dimensions_changed', (event) => {
  console.log(`Resized: ${event.previous} → ${event.current}`);
});

manager.setDimensions({ columns: 6, rows: 4 });
```

## Constructors

### Constructor

> **new ChartManager**(`options?`): `ChartManager`

Defined in: packages/client/src/lib/chart-manager/chart-manager.ts:57

Creates a new ChartManager instance.

#### Parameters

##### options?

[`ChartManagerOptions`](/reference/client/interfaces/chartmanageroptions/) = `{}`

Optional configuration

#### Returns

`ChartManager`

## Properties

### events

> `readonly` **events**: [`EventSubscriber`](/reference/client/interfaces/eventsubscriber/)\<[`ChartManagerEvents`](/reference/client/type-aliases/chartmanagerevents/)\>

Defined in: packages/client/src/lib/chart-manager/chart-manager.ts:47

***

### store

> `readonly` **store**: `Store`\<[`ChartManagerState`](/reference/client/type-aliases/chartmanagerstate/)\>

Defined in: packages/client/src/lib/chart-manager/chart-manager.ts:45

## Methods

### clearPendingResize()

> **clearPendingResize**(): `void`

Defined in: packages/client/src/lib/chart-manager/chart-manager.ts:130

Clears the pending resize update reason.

#### Returns

`void`

***

### dispose()

> **dispose**(): `void`

Defined in: packages/client/src/lib/chart-manager/chart-manager.ts:137

Permanently disposes the ChartManager and releases all resources.

#### Returns

`void`

***

### getDimensions()

> **getDimensions**(): `ChartDimensions`

Defined in: packages/client/src/lib/chart-manager/chart-manager.ts:68

Returns the current chart dimensions.

#### Returns

`ChartDimensions`

***

### getPendingResize()

> **getPendingResize**(): `ChartResizeReason` \| `null`

Defined in: packages/client/src/lib/chart-manager/chart-manager.ts:123

Returns the pending resize update reason, or null if none.

#### Returns

`ChartResizeReason` \| `null`

***

### setDimensions()

> **setDimensions**(`dimensions`): `void`

Defined in: packages/client/src/lib/chart-manager/chart-manager.ts:80

Updates the chart dimensions in the store.

If the dimensions have actually changed, a `dimensions_changed` event
is emitted and a pending resize update reason is buffered.

#### Parameters

##### dimensions

`ChartDimensions`

The new chart dimensions

#### Returns

`void`
