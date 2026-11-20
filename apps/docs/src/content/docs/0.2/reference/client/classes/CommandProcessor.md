---
editUrl: false
next: false
prev: false
title: "CommandProcessor"
---

Defined in: packages/client/src/lib/command-processor/command-processor.ts:147

Processes commands through a sequential event loop.

Each command is dispatched and processed in order.
Commands received during processing are queued and processed sequentially.

Processes commands via a sequential event loop:
- `dispatch(...commands)` queues one or more Commands (multiple = atomic batch)
- `setLayout(layout)` convenience for SetLayoutCommand
- `executeActions(executionPlan)` convenience for ExecuteActionsCommand
- Runner registration is exposed via pass-through methods

## Example

```ts
const processor = new CommandProcessor({ debug: true });

processor.events.on('command_complete', (event) => {
  console.log(`Processed in ${event.duration}ms`);
});

processor.dispatch({ kind: 'set_layout', layout: myLayout });
processor.executeActions(executionPlan);
```

## Constructors

### Constructor

> **new CommandProcessor**(`options?`): `CommandProcessor`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:170

#### Parameters

##### options?

[`CommandProcessorOptions`](/reference/client/interfaces/commandprocessoroptions/) = `{}`

#### Returns

`CommandProcessor`

## Properties

### events

> `readonly` **events**: [`EventSubscriber`](/reference/client/interfaces/eventsubscriber/)\<[`CommandProcessorEvents`](/reference/client/type-aliases/commandprocessorevents/)\>

Defined in: packages/client/src/lib/command-processor/command-processor.ts:150

***

### store

> `readonly` **store**: `Store`\<[`CommandProcessingState`](/reference/client/type-aliases/commandprocessingstate/)\>

Defined in: packages/client/src/lib/command-processor/command-processor.ts:148

## Accessors

### queueLength

#### Get Signature

> **get** **queueLength**(): `number`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:182

##### Returns

`number`

## Methods

### dispatch()

> **dispatch**(...`commands`): `void`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:241

Dispatch one or more commands for processing.
A single command is processed immediately (or queued).
Multiple commands form an atomic batch — processed sequentially
without returning to idle between them, and a command that throws
abandons the rest of its batch (`processing_error` names the failure,
`batch_abandoned` names what never ran). Commands dispatched separately
are independent: a failure in one does not stop the next.

A failure is reported through the `processing_error` event and through
the `Result` that `waitForIdle()` resolves with.

#### Parameters

##### commands

...[`Command`](/reference/client/type-aliases/command/)[]

#### Returns

`void`

***

### dispatchSettled()

> **dispatchSettled**(...`commands`): `Promise`\<[`CommandBatchResult`](/reference/client/type-aliases/commandbatchresult/)\>

Defined in: packages/client/src/lib/command-processor/command-processor.ts:252

Dispatch an atomic batch and observe only its own settlement. Never rejects.
A first-layout refusal is `failed`; action failures, skips, partial application
and disposal are `unknown`. Neither outcome proves external effects are safe
to retry. Unlike waitForIdle, unrelated commands cannot change this result.

#### Parameters

##### commands

...[`Command`](/reference/client/type-aliases/command/)[]

#### Returns

`Promise`\<[`CommandBatchResult`](/reference/client/type-aliases/commandbatchresult/)\>

***

### dispose()

> **dispose**(): `void`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:367

#### Returns

`void`

***

### executeActions()

> **executeActions**(`executionPlan`): `void`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:313

Convenience method to dispatch an ExecuteActionsCommand.

The actions run after this call returns, so neither a failing action nor
a failing command throws or rejects a promise here. Subscribe to
`action_error` for an individual action and to `processing_error` for the
command as a whole.

#### Parameters

##### executionPlan

readonly `ActionExecution`[]

The actions to execute

#### Returns

`void`

***

### registerRunner()

> **registerRunner**\<`V`\>(`instanceId`, `runner`): [`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

Defined in: packages/client/src/lib/command-processor/command-processor.ts:192

Register an action runner for a specific instance.

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

***

### runLocalAction()

> **runLocalAction**(`execution`): `Promise`\<`ActionInvocationOutcome`\>

Defined in: packages/client/src/lib/command-processor/command-processor.ts:347

Runs a single action through the same queue + ActionManager machinery as
an engine execution plan (readiness wait, execution timeout, action_error
emission) and resolves with that action's outcome so a caller can arbitrate
an optimistic-transition revert. Does not throw.

#### Parameters

##### execution

`ActionExecution`

#### Returns

`Promise`\<`ActionInvocationOutcome`\>

***

### setLayout()

> **setLayout**(`layout`): `void`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:299

Convenience method to dispatch a SetLayoutCommand.

The layout can be refused — a tiling tree that names the same instance in
two slots is rejected — and a refusal neither throws nor rejects a
promise, because the layout is applied after this call returns. Subscribe
to the `processing_error` event to detect one; dispatched as part of a
batch, a refusal also emits `batch_abandoned`. A refused layout (duplicate
tiling leaf) leaves the previous layout in place; observe the refusal via
`waitForIdle()` or `processing_error`. A malformed weight token is not a
refusal reason here — it is healed at render time — so only an
`initialLayout` seed rejects one.

#### Parameters

##### layout

`GridLayout` \| `TilingLayout`

The layout to apply

#### Returns

`void`

***

### setVariantIfCurrent()

> **setVariantIfCurrent**(`instanceId`, `expected`, `next`): `boolean`

Defined in: packages/client/src/lib/command-processor/command-processor.ts:324

Last-write-wins variant swap. Applies `next` only if the instance still
exists and its variant is exactly `expected`; returns whether it applied.
The guard is what makes an optimistic-transition revert safe: a newer
local invocation or an engine layout landing in between must not be
clobbered.

#### Parameters

##### instanceId

`InstanceId`

##### expected

`VariantName`

##### next

`VariantName`

#### Returns

`boolean`

***

### waitForIdle()

> **waitForIdle**(): `Promise`\<[`Result`](/reference/client/type-aliases/result/)\<`void`, `Error`\>\>

Defined in: packages/client/src/lib/command-processor/command-processor.ts:220

Returns a promise that resolves when the processor is idle and the
command queue is empty. Resolves immediately if already idle.

The resolved [Result](/reference/client/type-aliases/result/) reports whether the observed activity burst —
the run of commands between leaving idle and draining the queue — failed:
`ok` when every command in it completed, `err` with the most recent
failure otherwise. A refusal (such as a rejected `set_layout`) is
therefore visible to `dispatch(cmd); await waitForIdle();` without
subscribing to `processing_error` first: the error outlives the return
to idle and is only discarded when a new burst begins. Called while
already idle, it reports the outcome of the burst that most recently
completed (`ok` on a fresh processor).

The queue is shared, so the Result describes the burst as a whole, not
any one caller's commands; concurrent waiters observe the same value. A
waiter is bound to the burst that was in flight when it was issued, so a
burst started from the return-to-idle notification itself cannot overwrite
its result. The promise never rejects, and disposal settles pending waiters
with the outcome recorded so far.

#### Returns

`Promise`\<[`Result`](/reference/client/type-aliases/result/)\<`void`, `Error`\>\>
