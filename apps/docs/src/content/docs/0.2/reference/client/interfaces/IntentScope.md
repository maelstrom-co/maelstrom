---
editUrl: false
next: false
prev: false
title: "IntentScope"
---

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:74

Owner lifetime, not cancellation: retiring never interrupts a dispatched turn.

## Methods

### enqueueIntent()

> **enqueueIntent**(`intent`): [`IntentSubmission`](/reference/client/interfaces/intentsubmission/)

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:76

Admit through the same FIFO as unscoped users.

#### Parameters

##### intent

`string`

#### Returns

[`IntentSubmission`](/reference/client/interfaces/intentsubmission/)

***

### retire()

> **retire**(): `void`

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:78

Idempotently retire only pending work; future submissions are refused.

#### Returns

`void`
