---
editUrl: false
next: false
prev: false
title: "WithRetryOptions"
---

Defined in: packages/engine/src/lib/planner/with-retry.ts:13

Retry budget for [withRetry](/reference/engine/functions/withretry/).

## Properties

### max

> `readonly` **max**: `number`

Defined in: packages/engine/src/lib/planner/with-retry.ts:18

Maximum number of retries after the first attempt. Non-negative integer.
`0` still validates the candidate but never runs a second attempt.
