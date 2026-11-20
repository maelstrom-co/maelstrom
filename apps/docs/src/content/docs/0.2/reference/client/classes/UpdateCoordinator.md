---
editUrl: false
next: false
prev: false
title: "UpdateCoordinator"
---

Defined in: packages/client/src/lib/update-coordination/update-coordinator.ts:46

Coordinates update batching, coalescing, and flush scheduling.

Updates are queued and debounced for efficiency. Before flushing,
updates are coalesced:
- Only the latest `chart_resize` is kept
- `vessel_mutation` updates for the same instance are combined

User intents bypass the coordinator entirely and are handled
directly by the Orchestrator via `processIntent`.

## Example

```ts
const coordinator = new UpdateCoordinator({ debounceDelayMs: 300 });

coordinator.events.on('updates_flushed', (event) => {
  buildAndSendRequest(event.updates);
});

coordinator.schedule({ type: 'chart_resize', width: 800, height: 600 });
```

## Constructors

### Constructor

> **new UpdateCoordinator**(`options?`): `UpdateCoordinator`

Defined in: packages/client/src/lib/update-coordination/update-coordinator.ts:56

#### Parameters

##### options?

[`UpdateCoordinatorOptions`](/reference/client/interfaces/updatecoordinatoroptions/) = `{}`

#### Returns

`UpdateCoordinator`

## Properties

### events

> `readonly` **events**: [`EventSubscriber`](/reference/client/interfaces/eventsubscriber/)\<[`UpdateCoordinatorEvents`](/reference/client/type-aliases/updatecoordinatorevents/)\>

Defined in: packages/client/src/lib/update-coordination/update-coordinator.ts:48

## Accessors

### pendingCount

#### Get Signature

> **get** **pendingCount**(): `number`

Defined in: packages/client/src/lib/update-coordination/update-coordinator.ts:169

##### Returns

`number`

## Methods

### clear()

> **clear**(): `void`

Defined in: packages/client/src/lib/update-coordination/update-coordinator.ts:173

#### Returns

`void`

***

### dispose()

> **dispose**(): `void`

Defined in: packages/client/src/lib/update-coordination/update-coordinator.ts:182

#### Returns

`void`

***

### flush()

> **flush**(): `UpdateReason`[]

Defined in: packages/client/src/lib/update-coordination/update-coordinator.ts:98

Synchronously flushes all pending updates.

Coalesces updates, clears the queue, emits `updates_flushed`,
and returns the coalesced updates.

#### Returns

`UpdateReason`[]

***

### getPending()

> **getPending**(): `UpdateReason`[]

Defined in: packages/client/src/lib/update-coordination/update-coordinator.ts:161

#### Returns

`UpdateReason`[]

***

### hasPending()

> **hasPending**(): `boolean`

Defined in: packages/client/src/lib/update-coordination/update-coordinator.ts:165

#### Returns

`boolean`

***

### schedule()

> **schedule**(`reason`): `void`

Defined in: packages/client/src/lib/update-coordination/update-coordinator.ts:66

Queues an update reason for the next debounced flush.

No-op after disposal.

#### Parameters

##### reason

`UpdateReason`

#### Returns

`void`

***

### takeCoalesced()

> **takeCoalesced**(): `UpdateReason`[]

Defined in: packages/client/src/lib/update-coordination/update-coordinator.ts:129

Takes all pending updates (coalesced) without emitting events.

Useful for the `processIntent` path where the orchestrator
handles request assembly directly.

#### Returns

`UpdateReason`[]
