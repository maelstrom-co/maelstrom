---
editUrl: false
next: false
prev: false
title: "ConnectionManager"
---

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:69

Manages connection lifecycle, retry logic, and circuit breaker patterns
for Maelstrom engine connections.

Features:
- Owns its own TanStack Store for connection state
- TypedEmitter-based events exposed via `events: EventSubscriber`
- Exponential backoff retry logic with configurable options
- Circuit breaker pattern for fault tolerance
- Auto-reconnect on unexpected disconnections

## Example

```ts
const manager = new ConnectionManager(connector, {
  maxRetries: 3,
  initialDelayMs: 1000,
});

await manager.connect();
manager.events.on('connection_status_changed', (event) => {
  console.log(`Connection: ${event.status}`);
});
```

## Constructors

### Constructor

> **new ConnectionManager**(`connector`, `options`): `ConnectionManager`

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:90

#### Parameters

##### connector

[`EngineConnector`](/reference/client/interfaces/engineconnector/)

##### options

[`ConnectionManagerOptions`](/reference/client/interfaces/connectionmanageroptions/)

#### Returns

`ConnectionManager`

## Properties

### events

> `readonly` **events**: [`EventSubscriber`](/reference/client/interfaces/eventsubscriber/)\<[`ConnectionManagerEvents`](/reference/client/type-aliases/connectionmanagerevents/)\>

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:72

***

### store

> `readonly` **store**: `Store`\<[`ConnectionManagerState`](/reference/client/type-aliases/connectionmanagerstate/)\>

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:70

## Methods

### connect()

> **connect**(): `Promise`\<`void`\>

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:115

Establishes a connection to the engine with retry logic.

If the circuit breaker is open, this will throw an error immediately.
Otherwise, it will attempt to connect with exponential backoff retry.

This is the deliberate, user-initiated entry point, so it always starts
with a full `maxRetries` budget: `connectionRetryCount` is reset to 0
here regardless of what a previous connect/disconnect cycle left behind.
(The automatic-reconnect path is different — it only resets the count
after a connection survives `stabilityThresholdMs`, so a server that
accepts-then-immediately-closes still exhausts the budget. That delayed
reset is unaffected by this one.)

#### Returns

`Promise`\<`void`\>

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:138

Disconnects from the engine and cleans up connection state.

#### Returns

`Promise`\<`void`\>

***

### dispose()

> **dispose**(): `Promise`\<`void`\>

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:244

Permanently disposes the ConnectionManager and releases all resources.
After disposal, the ConnectionManager cannot be reused.

#### Returns

`Promise`\<`void`\>
