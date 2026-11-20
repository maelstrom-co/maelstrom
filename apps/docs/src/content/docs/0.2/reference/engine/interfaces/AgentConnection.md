---
editUrl: false
next: false
prev: false
title: "AgentConnection"
---

Defined in: packages/engine/src/lib/agent-session/connection.ts:49

One connection's ordered Agent Session event stream.

Capacity is bounded per connection:
- At most 32 utterances are pending, including the one being planned or
  awaiting acknowledgement. A further utterance receives an `error` event
  with code `queue_full` and is not remembered, so it can be sent again.
- At most 4,096 input IDs are remembered, with no eviction, so a repeated
  input is always ignored. After that, a new utterance receives an `error`
  event with code `session_capacity`. The host must open a new connection
  to continue.
- Each UI change waits for acknowledgement for at most
  [OpenConnectionOptions.acknowledgementTimeoutMs](/reference/engine/interfaces/openconnectionoptions/#acknowledgementtimeoutms), 30 seconds by
  default. A timeout fails the run and cancels queued work.

## Methods

### close()

> **close**(): `void`

Defined in: packages/engine/src/lib/agent-session/connection.ts:55

Aborts pending work and releases listeners. Idempotent; no later events are emitted.

#### Returns

`void`

***

### send()

> **send**(`input`): `Promise`\<`void`\>

Defined in: packages/engine/src/lib/agent-session/connection.ts:51

Accepts untrusted input. Resolves after handling it, without waiting for a later UI acknowledgement.

#### Parameters

##### input

`unknown`

#### Returns

`Promise`\<`void`\>

***

### subscribe()

> **subscribe**(`listener`): () => `void`

Defined in: packages/engine/src/lib/agent-session/connection.ts:53

Observes future events in emission order. Returns an unsubscribe function; there is no replay.

#### Parameters

##### listener

(`event`) => `void`

#### Returns

() => `void`
