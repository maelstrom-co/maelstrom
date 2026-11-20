---
editUrl: false
next: false
prev: false
title: "IntentSubmission"
---

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:62

Synchronous admission decision with a never-rejecting terminal promise.

## Properties

### accepted

> `readonly` **accepted**: `boolean`

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:66

False only for an immediate refusal; accepted work may later expire.

***

### id

> `readonly` **id**: `string`

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:64

Unique within the owning Orchestrator.

***

### result

> `readonly` **result**: `Promise`\<[`IntentResult`](/reference/client/type-aliases/intentresult/)\>

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:70

Resolves exactly once, even on timeout, replacement or disposal.

***

### store

> `readonly` **store**: `Store`\<[`IntentSnapshot`](/reference/client/type-aliases/intentsnapshot/)\>

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:68

Observe state; consumers must not mutate this store.
