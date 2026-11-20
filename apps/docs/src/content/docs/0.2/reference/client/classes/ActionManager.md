---
editUrl: false
next: false
prev: false
title: "ActionManager"
---

Defined in: packages/client/src/lib/command-processor/action-manager.ts:69

ActionManager handles action execution for vessel instances.

Components register typed action runners per instance to handle actions.
Actions are executed:
- In parallel across different instances
- Sequentially within the same instance (respects executionPlan order)

The manager includes a waitForReady mechanism to handle race conditions
where the server sends actions before components have registered their runners.

## Example

```typescript
const store = new Store(createInitialState());
const actionManager = new ActionManager();

// Register typed action handlers for a specific instance
actionManager.registerRunner('instance-1', {
  selectOrder: async (params) => {
    // params is fully typed based on vessel definition
    setSelectedOrderId(params.orderId);
    return ok(undefined);
  },
  closeOrderDetails: async () => {
    setSelectedOrderId(null);
    return ok(undefined);
  },
});

// Execute actions from a server response
const result = await actionManager.executeActions(response.executionPlan);
console.log(`Executed ${result.actions.length} actions`);
```

## Constructors

### Constructor

> **new ActionManager**(`options?`): `ActionManager`

Defined in: packages/client/src/lib/command-processor/action-manager.ts:77

#### Parameters

##### options?

###### executionTimeoutMs?

`number`

###### logger?

[`Logger`](/reference/client/classes/logger/)

###### readinessTimeoutMs?

`number`

#### Returns

`ActionManager`

## Methods

### dispose()

> **dispose**(): `void`

Defined in: packages/client/src/lib/command-processor/action-manager.ts:328

Release the manager: cancel every pending readiness wait so no timer
outlives disposal, and settle its waiters as not-ready.

Waiters resolve `false` rather than rejecting so an in-flight
[executeActions](/reference/client/classes/actionmanager/#executeactions) still returns its actions as skipped instead of
surfacing a rejection its callers do not expect. A disposed manager stays
silent and never schedules another readiness timer.

#### Returns

`void`

***

### executeActions()

> **executeActions**(`executionPlan`, `observe?`): `Promise`\<[`BatchExecutionResult`](/reference/client/interfaces/batchexecutionresult/)\>

Defined in: packages/client/src/lib/command-processor/action-manager.ts:229

Execute all actions in the execution plan.

Actions are grouped by instance and executed:
- In parallel across different instances
- Sequentially within the same instance (respects executionPlan order)

Waits for runners to be ready before executing. Actions are skipped if
no runner is registered within the timeout.

#### Parameters

##### executionPlan

readonly `ActionExecution`[]

Array of actions to execute

##### observe?

(`progress`) => `void`

#### Returns

`Promise`\<[`BatchExecutionResult`](/reference/client/interfaces/batchexecutionresult/)\>

Result of the batch execution

***

### getRegisteredInstances()

> **getRegisteredInstances**(): `InstanceId`[]

Defined in: packages/client/src/lib/command-processor/action-manager.ts:148

Get all registered instance IDs.

#### Returns

`InstanceId`[]

Array of instance IDs with registered runners

***

### hasRunner()

> **hasRunner**(`instanceId`): `boolean`

Defined in: packages/client/src/lib/command-processor/action-manager.ts:139

Check if a runner is registered for an instance.

#### Parameters

##### instanceId

`InstanceId`

The branded instance ID to check

#### Returns

`boolean`

true if a runner is registered

***

### registerRunner()

> **registerRunner**\<`V`\>(`instanceId`, `runner`): [`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

Defined in: packages/client/src/lib/command-processor/action-manager.ts:103

Register an action runner for a specific instance.
The runner is an object with typed action handlers.

#### Type Parameters

##### V

`V` *extends* `VesselDefinition`

#### Parameters

##### instanceId

`InstanceId`

The branded instance ID this runner handles

##### runner

[`ActionRunner`](/reference/client/type-aliases/actionrunner/)\<`V`\>

Object with action name -> handler function mapping

#### Returns

[`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

#### Example

```typescript
actionManager.registerRunner(InstanceId('instance-1'), {
  selectOrder: async (params) => {
    setSelectedOrderId(params.orderId);
    return ok(undefined);
  },
});
```

***

### waitForReady()

> **waitForReady**(`instanceId`, `timeoutMs?`): `Promise`\<`boolean`\>

Defined in: packages/client/src/lib/command-processor/action-manager.ts:170

Wait for a runner to be registered for an instance.
This handles the race condition where the server sends actions
before React components have mounted and registered their runners.

#### Parameters

##### instanceId

`InstanceId`

The branded instance ID to wait for

##### timeoutMs?

`number` = `5000`

Maximum time to wait (default: 5000ms)

#### Returns

`Promise`\<`boolean`\>

Promise that resolves to true if runner registered, false if the
wait timed out or the manager was disposed

#### Example

```typescript
const isReady = await actionManager.waitForReady(InstanceId('instance-1'), 3000);
if (isReady) {
  // Runner is available, actions can execute
}
```
