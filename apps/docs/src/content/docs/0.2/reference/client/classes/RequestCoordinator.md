---
editUrl: false
next: false
prev: false
title: "RequestCoordinator"
---

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:67

Manages the request lifecycle: sending requests, tracking in-flight state,
emitting processing events, and coordinating flush promises.

## Example

```ts
const coordinator = new RequestCoordinator(connector);
coordinator.events.on('processing_completed', (e) => console.log(`Done in ${e.durationMs}ms`));

const response = await coordinator.send(envelope);
```

## Constructors

### Constructor

> **new RequestCoordinator**(`connector`, `options?`): `RequestCoordinator`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:77

#### Parameters

##### connector

[`EngineConnector`](/reference/client/interfaces/engineconnector/)

##### options?

[`RequestCoordinatorOptions`](/reference/client/interfaces/requestcoordinatoroptions/) = `{}`

#### Returns

`RequestCoordinator`

## Properties

### events

> `readonly` **events**: [`EventSubscriber`](/reference/client/interfaces/eventsubscriber/)\<[`RequestCoordinatorEvents`](/reference/client/type-aliases/requestcoordinatorevents/)\>

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:70

***

### store

> `readonly` **store**: `Store`\<[`RequestCoordinatorState`](/reference/client/interfaces/requestcoordinatorstate/)\>

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:72

## Accessors

### isProcessing

#### Get Signature

> **get** **isProcessing**(): `boolean`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:89

##### Returns

`boolean`

***

### lastResponse

#### Get Signature

> **get** **lastResponse**(): `MaelstromResponse` \| `null`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:93

##### Returns

`MaelstromResponse` \| `null`

## Methods

### dispose()

> **dispose**(): `void`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:212

Retire request error reporting and reject queued flush promises.
Outstanding sends still settle with their transport outcome; this method
does not disconnect the transport.

#### Returns

`void`

***

### queueFlush()

> **queueFlush**(): `Promise`\<`MaelstromResponse` \| `null`\>

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:171

Returns a promise that settles when the next response arrives or the
next flush failure occurs. Use this to await an in-flight request when
`isProcessing` is true and you want to coalesce with it.

Resolves to `null` rather than a response when the in-flight request it
was coalescing with turns out to have been superseded (see
[resolveFlushPromises](/reference/client/classes/requestcoordinator/#resolveflushpromises)) — mirroring the `null` a caller already
gets back from `flushUpdates()` when there was nothing to report.

#### Returns

`Promise`\<`MaelstromResponse` \| `null`\>

***

### rejectFlushPromises()

> **rejectFlushPromises**(`error`): `void`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:200

Rejects all queued flush promises and clears the queue. Called when a
flush fails before a response is available. The caller is responsible
for logging if the error has not already been logged upstream — this
method does not log.

#### Parameters

##### error

`Error`

#### Returns

`void`

***

### resolveFlushPromises()

> **resolveFlushPromises**(`response`): `void`

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:187

Resolves all queued flush promises and clears the queue.

Pass `null` when the request they were coalescing with was discarded
(e.g. fenced out by a connector swap) rather than actually applied —
resolving with the discarded response itself would hand callers a
layout that was never dispatched, and every fenced call site must
settle these promises somehow or they hang until an unrelated later
request happens to resolve them with an irrelevant response.

#### Parameters

##### response

`MaelstromResponse` \| `null`

#### Returns

`void`

***

### send()

> **send**(`message`): `Promise`\<`MaelstromResponse`\>

Defined in: packages/client/src/lib/orchestrator/request-coordinator.ts:115

Send a request and preserve its transport outcome for the caller.
Failures received after disposal no longer report a live request error.

#### Parameters

##### message

`ChartRequestMessage`

#### Returns

`Promise`\<`MaelstromResponse`\>
