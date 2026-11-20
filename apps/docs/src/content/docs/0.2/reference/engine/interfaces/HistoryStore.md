---
editUrl: false
next: false
prev: false
title: "HistoryStore"
---

Defined in: packages/engine/src/lib/history/history-store.ts:55

Backing persistence for [HistoryManager](/reference/engine/interfaces/historymanager/). The engine ships an
in-memory reference implementation; production deployments provide their
own (Redis, Postgres, SQLite, etc.).

Implementations MUST guarantee that [append](/reference/engine/interfaces/historystore/#append) is atomic with respect
to concurrent calls sharing the same `(sessionId, entry.input.id)` pair —
exactly one wins and the duplicate reports `{ inserted: false }`. In
single-process JavaScript this is free; in multi-process deployments use
the backend's native primitives (`INSERT OR IGNORE`, `ON CONFLICT DO NOTHING`,
Redis `SETNX`, etc.).

## Type Parameters

### TMeta

`TMeta` = `unknown`

## Methods

### append()

> **append**(`sessionId`, `entry`): `Promise`\<\{ `inserted`: `boolean`; \}\>

Defined in: packages/engine/src/lib/history/history-store.ts:60

Atomically check-and-insert. Returns `{ inserted: false }` if an entry
with the same MessageId already exists in the given session.

#### Parameters

##### sessionId

`SessionId`

##### entry

[`HistoryEntry`](/reference/engine/type-aliases/historyentry/)\<`TMeta`\>

#### Returns

`Promise`\<\{ `inserted`: `boolean`; \}\>

***

### clear()

> **clear**(`sessionId`): `Promise`\<`void`\>

Defined in: packages/engine/src/lib/history/history-store.ts:75

Wipes all entries for a session. No-op on an unknown session.

#### Parameters

##### sessionId

`SessionId`

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(`sessionId`): `Promise`\<readonly [`HistoryEntry`](/reference/engine/type-aliases/historyentry/)\<`TMeta`\>[]\>

Defined in: packages/engine/src/lib/history/history-store.ts:66

Returns all entries for a session in insertion order.

#### Parameters

##### sessionId

`SessionId`

#### Returns

`Promise`\<readonly [`HistoryEntry`](/reference/engine/type-aliases/historyentry/)\<`TMeta`\>[]\>

***

### getResponseById()

> **getResponseById**(`sessionId`, `messageId`): `Promise`\<`GetResponseByIdResult`\>

Defined in: packages/engine/src/lib/history/history-store.ts:90

Point-lookup of a previously recorded `turn`'s response.

Returns one of three semantically distinct outcomes (see
GetResponseByIdResult). The engine's replay path treats `miss`
and `kind-mismatch` identically (both fall through to a fresh LLM
call), but the type-level distinction lets the consumer decide what
to do about a `messageId` reuse across kinds — surface it as a
warning, page on it, etc. Stores backed by a remote backend should
implement this against backend-native point-lookup primitives (Redis
`HGET`, Postgres `SELECT response WHERE …`) to avoid materializing
the full [HistoryEntry](/reference/engine/type-aliases/historyentry/).

#### Parameters

##### sessionId

`SessionId`

##### messageId

`MessageId`

#### Returns

`Promise`\<`GetResponseByIdResult`\>

***

### replace()

> **replace**(`sessionId`, `entries`): `Promise`\<`void`\>

Defined in: packages/engine/src/lib/history/history-store.ts:69

Overwrites the session's entry list. Used by truncation.

#### Parameters

##### sessionId

`SessionId`

##### entries

readonly [`HistoryEntry`](/reference/engine/type-aliases/historyentry/)\<`TMeta`\>[]

#### Returns

`Promise`\<`void`\>
