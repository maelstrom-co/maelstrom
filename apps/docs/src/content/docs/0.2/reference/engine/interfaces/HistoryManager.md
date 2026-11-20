---
editUrl: false
next: false
prev: false
title: "HistoryManager"
---

Defined in: packages/engine/src/lib/history/history-manager.ts:104

Per-session conversation history coordinator. Wraps a [HistoryStore](/reference/engine/interfaces/historystore/)
with the session-scoped policy the engine pipeline needs:

- [recordTurn](/reference/engine/interfaces/historymanager/#recordturn) writes a completed `chart_request` turn under a
  per-session async mutex, then truncates the session against the
  `maxEntries` / `maxChars` budgets.
- [addAssistantMessage](/reference/engine/interfaces/historymanager/#addassistantmessage) persists a developer-supplied assistant
  message lock-free; idempotency is delegated to the store.
- [getLLMContext](/reference/engine/interfaces/historymanager/#getllmcontext) projects retained entries into the slim
  `LLMContextMessage[]` shape the prompt builder consumes.

`createEngine` constructs one of these internally when [HistoryConfig](/reference/engine/interfaces/historyconfig/)
is supplied; consumers building a custom engine pipeline can construct it
directly via [createHistoryManager](/reference/engine/functions/createhistorymanager/).

Concurrency note: the per-session mutex is process-local. Distributed
deployments must serialize `chart_request` turns externally (sticky
routing, distributed lease, etc.) — see the README's Concurrency section.

## Type Parameters

### TMeta

`TMeta` = `unknown`

## Methods

### addAssistantMessage()

> **addAssistantMessage**(`input`): `Promise`\<\{ `inserted`: `boolean`; \}\>

Defined in: packages/engine/src/lib/history/history-manager.ts:122

Persist a developer-supplied assistant message into history.

**Ordering.** The store append is lock-free, so `addAssistantMessage`
does not queue behind a long-running `recordTurn`. Callers that need an
injection to be visible to the next `chart_request` must `await` the
returned promise before issuing that request — the await is the
ordering primitive, not internal serialization. Concurrent unawaited
calls have no ordering guarantee against `recordTurn` reads.

Truncation, separately, runs under the per-session mutex so injection
truncation and turn truncation cannot race their `store.replace` calls.

#### Parameters

##### input

`AssistantInjectionMessage`

#### Returns

`Promise`\<\{ `inserted`: `boolean`; \}\>

***

### clear()

> **clear**(`sessionId`): `Promise`\<`void`\>

Defined in: packages/engine/src/lib/history/history-manager.ts:127

#### Parameters

##### sessionId

`SessionId`

#### Returns

`Promise`\<`void`\>

***

### getHistory()

> **getHistory**(`sessionId`): `Promise`\<readonly [`HistoryEntry`](/reference/engine/type-aliases/historyentry/)\<`TMeta`\>[]\>

Defined in: packages/engine/src/lib/history/history-manager.ts:125

#### Parameters

##### sessionId

`SessionId`

#### Returns

`Promise`\<readonly [`HistoryEntry`](/reference/engine/type-aliases/historyentry/)\<`TMeta`\>[]\>

***

### getLLMContext()

> **getLLMContext**(`sessionId`): `Promise`\<readonly [`LLMContextMessage`](/reference/engine/interfaces/llmcontextmessage/)[]\>

Defined in: packages/engine/src/lib/history/history-manager.ts:126

#### Parameters

##### sessionId

`SessionId`

#### Returns

`Promise`\<readonly [`LLMContextMessage`](/reference/engine/interfaces/llmcontextmessage/)[]\>

***

### getResponseById()

> **getResponseById**(`sessionId`, `messageId`): `Promise`\<`GetResponseByIdResult`\>

Defined in: packages/engine/src/lib/history/history-manager.ts:134

Point-lookup of a previously recorded `turn`'s response. Pure passthrough
to [HistoryStore.getResponseById](/reference/engine/interfaces/historystore/#getresponsebyid); lock-free read. See
GetResponseByIdResult for the three outcomes (`hit`, `miss`,
`kind-mismatch`).

#### Parameters

##### sessionId

`SessionId`

##### messageId

`MessageId`

#### Returns

`Promise`\<`GetResponseByIdResult`\>

***

### recordTurn()

> **recordTurn**(`input`, `output`): `Promise`\<`void`\>

Defined in: packages/engine/src/lib/history/history-manager.ts:105

#### Parameters

##### input

`ChartRequestMessage`

##### output

`ChartResponseOutput`

#### Returns

`Promise`\<`void`\>
