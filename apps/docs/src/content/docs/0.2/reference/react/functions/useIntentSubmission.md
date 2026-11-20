---
editUrl: false
next: false
prev: false
title: "useIntentSubmission"
---

> **useIntentSubmission**(`submission`): `IntentSnapshot` \| `null`

Defined in: packages/react/src/lib/use-intent-submission.ts:9

Observe a client ticket through atomic application settlement, or null before
submission. Subscription cleanup never cancels work. Operational failures are
terminal snapshots, not thrown errors; unknown must not be retried automatically.

## Parameters

### submission

`IntentSubmission` \| `null`

## Returns

`IntentSnapshot` \| `null`
