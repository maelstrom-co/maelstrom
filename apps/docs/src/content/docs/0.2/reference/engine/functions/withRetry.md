---
editUrl: false
next: false
prev: false
title: "withRetry"
---

## Call Signature

> **withRetry**\<`In`\>(`stage`, `options`): [`Stage`](/reference/engine/type-aliases/stage/)\<`In`, [`PlannerCandidate`](/reference/engine/type-aliases/plannercandidate/)\>

Defined in: packages/engine/src/lib/planner/with-retry.ts:49

Re-runs `stage` while the Engine's validation recommends a retry, up to
`options.max` retries (`max + 1` attempts in total).

Each candidate is checked with `ctx.validate`. A retry happens only when
the validation report sets `retryHint.recommend`; the retry receives the
original input plus [RetryFeedback](/reference/engine/interfaces/retryfeedback/) about the attempt just rejected
(never earlier ones). Every `Err`, from the stage or from validation, is
returned at once without using the budget. When the budget runs out, the
last candidate returns to the Engine: healing keeps it renderable, but
unresolved application requirements still prevent delivery.

The signal is not checked between attempts; each attempt is responsible
for observing it.

Logs `Retrying after recommended retry`, `Retry succeeded` and
`Retries exhausted` (the last only when `max > 0`), at a level derived from
the retry severity.

### Type Parameters

#### In

`In`

The input the wrapped stage receives, before retry feedback is added.

### Parameters

#### stage

[`Stage`](/reference/engine/type-aliases/stage/)\<[`Retryable`](/reference/engine/type-aliases/retryable/)\<`In`\>, [`PlannerCandidate`](/reference/engine/type-aliases/plannercandidate/)\>

#### options

[`WithRetryOptions`](/reference/engine/interfaces/withretryoptions/)

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<`In`, [`PlannerCandidate`](/reference/engine/type-aliases/plannercandidate/)\>

### Throws

If `options.max` is not a non-negative integer.

### Example

```ts
// `modelPlanner` is any `Planner`, for example one that calls a model.
const planner = withRetry(modelPlanner, { max: 1 });
```

## Call Signature

> **withRetry**\<`In`\>(`stage`, `options`): [`Stage`](/reference/engine/type-aliases/stage/)\<`In`, [`ReplylessCandidate`](/reference/engine/type-aliases/replylesscandidate/)\>

Defined in: packages/engine/src/lib/planner/with-retry.ts:61

[withRetry](/reference/engine/functions/withretry/) for a stage that may omit `userMessage`: the retry
feedback carries the [ReplylessCandidate](/reference/engine/type-aliases/replylesscandidate/) the previous attempt
produced, and the wrapper returns replyless candidates too.

### Type Parameters

#### In

`In`

The input the wrapped stage receives, before retry feedback is added.

### Parameters

#### stage

[`Stage`](/reference/engine/type-aliases/stage/)\<[`Retryable`](/reference/engine/type-aliases/retryable/)\<`In`, [`ReplylessCandidate`](/reference/engine/type-aliases/replylesscandidate/)\>, [`ReplylessCandidate`](/reference/engine/type-aliases/replylesscandidate/)\>

#### options

[`WithRetryOptions`](/reference/engine/interfaces/withretryoptions/)

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<`In`, [`ReplylessCandidate`](/reference/engine/type-aliases/replylesscandidate/)\>

### Throws

If `options.max` is not a non-negative integer.

## Call Signature

> **withRetry**\<`In`\>(`stage`, `options`): [`Stage`](/reference/engine/type-aliases/stage/)\<`In`, [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)\>

Defined in: packages/engine/src/lib/planner/with-retry.ts:78

[withRetry](/reference/engine/functions/withretry/) for a stage that may return any [PlannerOutput](/reference/engine/type-aliases/planneroutput/),
including a needs-clarification result: the retry feedback carries the
[ReplylessCandidate](/reference/engine/type-aliases/replylesscandidate/) the previous attempt produced, and the wrapper
returns any `PlannerOutput` too.

A needs-clarification result is returned unchanged on the attempt that
produced it, without validation or retry: it has no layout to heal, and
the Engine decides whether the request allows it.

### Type Parameters

#### In

`In`

The input the wrapped stage receives, before retry feedback is added.

### Parameters

#### stage

[`Stage`](/reference/engine/type-aliases/stage/)\<[`Retryable`](/reference/engine/type-aliases/retryable/)\<`In`, [`ReplylessCandidate`](/reference/engine/type-aliases/replylesscandidate/)\>, [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)\>

#### options

[`WithRetryOptions`](/reference/engine/interfaces/withretryoptions/)

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<`In`, [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)\>

### Throws

If `options.max` is not a non-negative integer.
