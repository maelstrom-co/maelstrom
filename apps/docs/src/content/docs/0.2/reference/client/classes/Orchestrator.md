---
editUrl: false
next: false
prev: false
title: "Orchestrator"
---

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:130

Composition root that creates, wires, and coordinates all microkernels.

The Orchestrator owns **zero private state** and emits **zero events**.
It sequences calls across microkernels in the right order.
Consumers interact with microkernels directly for domain operations.

## Example

```ts
const connector = new WebSocketConnector({ url: 'wss://api.example.com/ws' });
const orchestrator = new Orchestrator(connector, { debug: true });

await orchestrator.connect();
const response = await orchestrator.processIntent('show me sales data');

// Listen for events via microkernels directly:
orchestrator.requestCoordinator.events.on('processing_completed', (e) => { ... });
orchestrator.chartManager.setDimensions({ columns: 10, rows: 6 });
```

## Throws

If `options.initialLayout` is not a tiling layout (a grid layout
only repositions instances that already exist, and none do at
construction).

## Throws

If `options.initialLayout` is present and `options.layoutMode` is
`'grid'` — the seed's type and the mode must agree.

## Throws

If `options.initialLayout` declares the same `instanceId` twice.

## Throws

If an `options.initialLayout` tree contains a split token whose
weight suffix is malformed — anything an engine response would have
repaired, such as `"V:1,5000"` or `"V:01,1"`. A seed is rejected rather
than repaired: the lenient-LLM / strict-developer asymmetry means the
author is told, instead of being handed geometry they did not write.

## Throws

If an `options.initialLayout` tree names the same instance in two
leaves. An instance renders as exactly one tile; weight the split token
instead of repeating the leaf.

## Throws

If an `options.initialLayout` tree leaf is not declared in its
`instances`, or a declared instance is referenced by no tree leaf.

## Throws

If an `options.initialLayout` instance names a vessel that is not
registered via `options.vessels`, or a variant that vessel does not
declare.

## Constructors

### Constructor

> **new Orchestrator**(`connector`, `options?`): `Orchestrator`

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:168

#### Parameters

##### connector

[`EngineConnector`](/reference/client/interfaces/engineconnector/)

##### options?

[`OrchestratorOptions`](/reference/client/type-aliases/orchestratoroptions/) = `{}`

#### Returns

`Orchestrator`

## Properties

### diagnostics

> `readonly` **diagnostics**: [`DiagnosticChannel`](/reference/client/classes/diagnosticchannel/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:132

Optional diagnostic observation, isolated from application operations.

## Accessors

### chartManager

#### Get Signature

> **get** **chartManager**(): [`ChartManager`](/reference/client/classes/chartmanager/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:342

##### Returns

[`ChartManager`](/reference/client/classes/chartmanager/)

***

### commandProcessor

#### Get Signature

> **get** **commandProcessor**(): [`CommandProcessor`](/reference/client/classes/commandprocessor/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:334

##### Returns

[`CommandProcessor`](/reference/client/classes/commandprocessor/)

***

### connectionManager

#### Get Signature

> **get** **connectionManager**(): [`ConnectionManager`](/reference/client/classes/connectionmanager/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:330

##### Returns

[`ConnectionManager`](/reference/client/classes/connectionmanager/)

***

### intentScheduler

#### Get Signature

> **get** **intentScheduler**(): [`IntentSchedulerView`](/reference/client/interfaces/intentschedulerview/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:561

Shared admission state; network telemetry alone does not imply readiness.

##### Returns

[`IntentSchedulerView`](/reference/client/interfaces/intentschedulerview/)

***

### requestCoordinator

#### Get Signature

> **get** **requestCoordinator**(): [`RequestCoordinator`](/reference/client/classes/requestcoordinator/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:346

##### Returns

[`RequestCoordinator`](/reference/client/classes/requestcoordinator/)

***

### vesselManager

#### Get Signature

> **get** **vesselManager**(): [`VesselManager`](/reference/client/classes/vesselmanager/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:338

##### Returns

[`VesselManager`](/reference/client/classes/vesselmanager/)

## Methods

### addAssistantMessage()

> **addAssistantMessage**(`message`): `Promise`\<`void`\>

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:883

#### Parameters

##### message

`string`

#### Returns

`Promise`\<`void`\>

***

### addAssistantMessageAcknowledged()

> **addAssistantMessageAcknowledged**(`args`): `Promise`\<[`AssistantMessageOutcome`](/reference/client/type-aliases/assistantmessageoutcome/)\>

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:909

Insert an assistant message into engine history and report whether the
engine stored it or recognized it as a duplicate.

Used by greeting flows that must prove persistence before speech and must
not speak twice for one session: `'inserted'` means this call created the
record; `'deduped'` means an equal `id` already existed.

Requires an active connector that implements
[AcknowledgedAssistantConnector](/reference/client/interfaces/acknowledgedassistantconnector/).

#### Parameters

##### args

###### id

[`MessageId`](/reference/client/type-aliases/messageid/)

Stable message id; identity for engine-side dedupe.

###### message

`string`

Exact assistant text to persist.

#### Returns

`Promise`\<[`AssistantMessageOutcome`](/reference/client/type-aliases/assistantmessageoutcome/)\>

#### Throws

If called after [dispose](/reference/client/classes/orchestrator/#dispose).

#### Throws

If the active connector lacks acknowledged-assistant support.

#### Throws

Propagates connector transport, engine, close, and timeout failures.

***

### connect()

> **connect**(): `Promise`\<`void`\>

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:854

#### Returns

`Promise`\<`void`\>

***

### createIntentScope()

> **createIntentScope**(): [`IntentScope`](/reference/client/interfaces/intentscope/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:579

Create a lifetime that retires only its pending intents, never active work.

#### Returns

[`IntentScope`](/reference/client/interfaces/intentscope/)

***

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:858

#### Returns

`Promise`\<`void`\>

***

### dispose()

> **dispose**(): `Promise`\<`void`\>

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:1004

Retire scheduled updates and request error reporting before transport shutdown.
Coalesced flushes resolve to `null` because their response cannot be applied.
In-flight intents still settle with their transport outcome.

#### Returns

`Promise`\<`void`\>

***

### enqueueIntent()

> **enqueueIntent**(`intent`, `options?`): [`IntentSubmission`](/reference/client/interfaces/intentsubmission/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:571

Accept into the bounded FIFO synchronously. Request snapshots are built at
dispatch, after earlier response application settles. Operational failures
resolve the ticket result; unknown outcomes must not be automatically retried.
Throws only for a scope belonging to another Orchestrator.

#### Parameters

##### intent

`string`

##### options?

[`EnqueueIntentOptions`](/reference/client/interfaces/enqueueintentoptions/)

#### Returns

[`IntentSubmission`](/reference/client/interfaces/intentsubmission/)

***

### flushUpdates()

> **flushUpdates**(): `Promise`\<`MaelstromResponse` \| `null`\>

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:671

Send whatever the UpdateCoordinator has buffered now, instead of waiting
for its debounce to fire, and apply the response the same way
[processIntent](/reference/client/classes/orchestrator/#processintent) does.

Use it when something must reach the engine at a known moment — a test, a
teardown, a UI gesture that should not sit out the debounce window. If a
request is already in flight this coalesces with it rather than sending a
second one: the buffered updates are put back and the returned promise
settles with that request's outcome. After an immediate intent has delivered
its response, new flushes wait for the next engine turn even if that intent's
actions are still settling.

RESOLVES `null` — deliberately the same value for every "nothing landed"
case, because none of them is a failure the caller can act on:
- the Orchestrator is disposed;
- nothing was buffered;
- disconnect removed buffered work waiting for a future engine turn;
- a concurrent [setConnector](/reference/client/classes/orchestrator/#setconnector) superseded the response, which was
  therefore never applied (the updates are requeued for the next flush);
- the send itself failed *because* of that swap — the transport error is
  swallowed rather than thrown, and logged at warn with the epoch that
  fenced it, which is the only thing distinguishing it from a request
  that was never sent.

REJECTS with the transport's error when a send fails under the current
connector — an ordinary failure, not a fenced one, is never swallowed.

#### Returns

`Promise`\<`MaelstromResponse` \| `null`\>

***

### getCapabilitySnapshot()

> **getCapabilitySnapshot**(): [`CapabilitySnapshot`](/reference/client/interfaces/capabilitysnapshot/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:406

Capability catalog (vessels, variants, actions) for `get_capabilities` pulls.

#### Returns

[`CapabilitySnapshot`](/reference/client/interfaces/capabilitysnapshot/)

***

### getConfig()

> **getConfig**(): [`ResolvedOrchestratorOptions`](/reference/client/interfaces/resolvedorchestratoroptions/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:354

#### Returns

[`ResolvedOrchestratorOptions`](/reference/client/interfaces/resolvedorchestratoroptions/)

***

### getHistory()

> **getHistory**(`sessionId`): `Promise`\<readonly `SessionHistoryEntry`[]\>

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:938

Fetch the engine-recorded history for the given session.

Use this to rehydrate a conversation after a refresh, on a new device,
or in a parallel tab — anywhere a developer has persisted a session id
and wants to seed UI state from the server. The session id is passed
explicitly (rather than read from the orchestrator's own
`config.sessionId`) so callers can fetch any session they have an id
for, including a session that predates this orchestrator instance.

Errors from the connector (transport failure, engine error) propagate
as thrown `Error`s — same shape as `addAssistantMessage` and
`processIntent`.

#### Parameters

##### sessionId

[`SessionId`](/reference/client/type-aliases/sessionid/)

#### Returns

`Promise`\<readonly `SessionHistoryEntry`[]\>

***

### getStructuralSnapshot()

> **getStructuralSnapshot**(): [`UIStructuralSnapshot`](/reference/client/interfaces/uistructuralsnapshot/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:369

Structural-only UI snapshot for grounding + `get_ui_state` pulls.

#### Returns

[`UIStructuralSnapshot`](/reference/client/interfaces/uistructuralsnapshot/)

***

### getViewState()

> **getViewState**(): [`OrchestratorViewState`](/reference/client/interfaces/orchestratorviewstate/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:358

#### Returns

[`OrchestratorViewState`](/reference/client/interfaces/orchestratorviewstate/)

***

### invokeAction()

> **invokeAction**(`instanceId`, `action`, `params?`): `void`

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:761

Invoke a vessel action locally — the client-authoritative path for actions
a user triggers directly in the UI (e.g. a button click), as opposed to
actions the engine returns in an execution plan.

WHAT it does, in order:
1. Validates that `instanceId` exists and that `action` is declared on the
   instance's **current** variant. If either check fails it logs a warning
   and no-ops — it never throws, so it is safe to call straight from a
   render callback.
2. If the action declares a `transitionsTo` variant that exists on the
   vessel, it updates the store's variant **synchronously, before the
   runner runs** — the store is authoritative and the UI reflects the new
   variant immediately (no optimistic-override-then-rollback dance).
3. Runs the action's registered runner through the same CommandProcessor /
   ActionManager machinery as engine-plan actions (runner-readiness wait,
   execution timeout, `action_error` emission).
4. If the runner fails (error result, throw, or timeout), reverts the
   variant — but only if the store variant is still the one this call set,
   so a newer transition or an engine layout that landed in between wins.
5. When (and only when) a transition actually happened in step 2, schedules
   a `vessel_mutation` update so the engine can re-plan layout. Bursts are
   coalesced by the UpdateCoordinator's debounce.

WHY: vessels declare their own state machines, so a locally-invoked action
with a `transitionsTo` is a fact the client already knows — applying it
locally makes the client the authority instead of waiting on an engine
round-trip.

INVARIANTS:
- Never throws; invalid input warns and no-ops.
- The variant transition is applied before the runner is awaited.
- A revert never clobbers a variant a later write already changed.
- No `transitionsTo`, or no effective variant change → no engine update.

#### Parameters

##### instanceId

`InstanceId`

The instance to act on; must exist in the store.

##### action

`ActionName`

The action name; must be declared on the current variant.

##### params?

`Record`\<`string`, `unknown`\>

Optional parameter object passed to the runner verbatim.

#### Returns

`void`

#### Example

```ts
// In a vessel's render callback:
<button onClick={() => orchestrator.invokeAction(instanceId, 'expand')}>
  Expand
</button>
```

***

### onSettled()

> **onSettled**(`cb`): [`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:436

Subscribe to the render-settled signal.

Fires whenever the CommandProcessor's command queue drains back to
idle — the moment a batch of layout + action commands has fully
applied. Both settle sources required by grounding reach this
transition: an engine response dispatched via `processIntent` /
`flushUpdates` (`set_layout` + `execute_actions` as one atomic batch),
and direct manipulation (a user click / variant change, which reaches
the processor through `commandProcessor.executeActions()` the same way
a React `executeAction` call does). Neither path bypasses the queue, so
a single subscription to the queue-idle transition grounds both.

This is the grounding-push trigger only — it is NOT how speak-after-render
is sequenced. That flow awaits a specific intent's own
`commandProcessor.waitForIdle()` after `processIntent` resolves, so it
correlates to that intent's response rather than racing this global signal.

May fire more than once per logical settle (each queue-drain-to-idle
transition invokes it); downstream consumers that only want the latest
state should debounce.

#### Parameters

##### cb

() => `void`

#### Returns

[`Unsubscribe`](/reference/client/type-aliases/unsubscribe/)

***

### processIntent()

> **processIntent**(`intent`): `Promise`\<`MaelstromResponse`\>

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:493

Send a user intent to the engine and apply the response it plans.

Any updates buffered by the UpdateCoordinator ride along in the same
request, so an intent typed right after a resize or a vessel mutation
asks the engine to plan against what the board actually looks like. The
response is dispatched as one atomic batch — layout first, then actions
— before the legacy response/flush promises resolve. These promises do not
certify action success. Use [enqueueIntent](/reference/client/classes/orchestrator/#enqueueintent) for exact-batch outcomes.

Single-flight includes response application and active local commands, not
just network time. Older accepted users also take priority. This rejects
with [RequestInFlightError](/reference/client/classes/requestinflighterror/) rather than queueing, and its admission
lock remains held through command settlement after this promise resolves.

REJECTS WITH:
- `RequestInFlightError` — a request is already in flight; retry when
  the shared scheduler and command processor become idle.
- `ConnectorSupersededError` — a concurrent [setConnector](/reference/client/classes/orchestrator/#setconnector) replaced
  the connector while this request was in flight. The response was
  deliberately never applied locally. Server-side effects may be uncertain;
  do not automatically retry.
- the transport's own error — either an ordinary send failure, or the
  failure a swap itself caused when the outgoing connector was
  disconnected out from under this request. Both shapes mean the intent
  may have effects; do not automatically retry uncertain work.
- `Error('Orchestrator is disposed')` — called after [dispose](/reference/client/classes/orchestrator/#dispose).

INVARIANTS:
- Whenever a fenced outcome discards the response, the updates that rode
  along are requeued for the next flush — but the intent itself is not.
  Re-issuing it is the caller's call to make.
- A response that arrives after [dispose](/reference/client/classes/orchestrator/#dispose) still resolves here: the
  request was legitimately issued, it simply is never dispatched into a
  torn-down CommandProcessor.

#### Parameters

##### intent

`string`

#### Returns

`Promise`\<`MaelstromResponse`\>

***

### scheduleUpdate()

> **scheduleUpdate**(`reason`): `void`

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:639

#### Parameters

##### reason

`ChartResizeReason` \| `VesselMutationReason`

#### Returns

`void`

***

### setConnector()

> **setConnector**(`next`): `void`

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:971

Replace the connector on a live Orchestrator, preserving the session.

Use this when the transport changes but the session does not — re-auth is
the motivating case. The arranged board, vessel registry, and chart
dimensions all survive; only the transport is swapped.

Any request already in flight is *fenced*, not cancelled: `EngineConnector`
exposes no abort, so the old request runs to completion and its response
is discarded rather than applied. The guarantee is scoped to dispatch: a
response computed under superseded credentials is never handed to the
CommandProcessor, so it cannot reach the UI — but it has already been
committed to `requestCoordinator.lastResponse` and emitted as
`processing_completed` by the time the fence runs, so anything subscribed
to those two surfaces still observes it.

A caller's pending [processIntent](/reference/client/classes/orchestrator/#processintent) always *rejects* under a swap,
in one of two shapes: [ConnectorSupersededError](/reference/client/classes/connectorsupersedederror/) when the response
arrived after the swap, or the transport's own error when the swap made
the send itself fail (the outgoing connector was disconnected out from
under it). Either way the intent took no effect and must be re-issued.
A pending [flushUpdates](/reference/client/classes/orchestrator/#flushupdates) resolves `null` for both shapes instead —
its updates are requeued, so there is nothing for the caller to redo.

#### Parameters

##### next

[`EngineConnector`](/reference/client/interfaces/engineconnector/)

#### Returns

`void`

***

### setLayoutMode()

> **setLayoutMode**(`mode`): `void`

Defined in: packages/client/src/lib/orchestrator/orchestrator.ts:391

Change the layout mode for subsequent engine requests.

The mode is read fresh on every request and view-state read — it is
never captured at construction — so this takes effect on the next
request with no rebuild and no session teardown. The client does not
lay anything out itself; the mode is forwarded to the engine, which
decides.

This does not touch the stored layout. If the stored layout's own
`type` no longer agrees with `mode`, `buildChartRequest` resynthesizes
a fresh, empty layout of the requested type at request-build time
instead of forwarding the stale one — see the comment there for why
that has to happen at build time rather than here. That resynthesis
costs the arranged board, so this warns when it commits to it: the
same combination the constructor rejects outright is merely lossy
here, and the loss is otherwise invisible.

#### Parameters

##### mode

`LayoutMode`

#### Returns

`void`
