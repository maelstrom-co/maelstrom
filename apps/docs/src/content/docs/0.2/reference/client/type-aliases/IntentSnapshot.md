---
editUrl: false
next: false
prev: false
title: "IntentSnapshot"
---

> **IntentSnapshot** = [`IntentResult`](/reference/client/type-aliases/intentresult/) \| \{ `queuePosition`: `number` \| `null`; `status`: `"queued"` \| `"processing"`; \}

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:52

Observable ticket state; subscribe before reading store.state to avoid missed transitions.

## Union Members

[`IntentResult`](/reference/client/type-aliases/intentresult/)

***

### Type Literal

\{ `queuePosition`: `number` \| `null`; `status`: `"queued"` \| `"processing"`; \}

#### queuePosition

> `readonly` **queuePosition**: `number` \| `null`

One-based FIFO position when queued, otherwise null.

#### status

> `readonly` **status**: `"queued"` \| `"processing"`

Queued work has not sent; processing spans sending and atomic command settlement.
