---
editUrl: false
next: false
prev: false
title: "IntentResult"
---

> **IntentResult** = \{ `response`: `MaelstromResponse`; `status`: `"applied"`; \} \| \{ `reason`: [`IntentNotSubmittedReason`](/reference/client/type-aliases/intentnotsubmittedreason/); `status`: `"not_submitted"`; \} \| \{ `error`: `Error`; `status`: `"failed"` \| `"unknown"`; \}

Defined in: packages/client/src/lib/orchestrator/intent-scheduler.types.ts:31

Exactly one terminal outcome. Unknown work must not be retried automatically.

## Union Members

### Type Literal

\{ `response`: `MaelstromResponse`; `status`: `"applied"`; \}

#### response

> `readonly` **response**: `MaelstromResponse`

Engine response applied to the client.

#### status

> `readonly` **status**: `"applied"`

Response and its atomic layout/action batch completed successfully.

***

### Type Literal

\{ `reason`: [`IntentNotSubmittedReason`](/reference/client/type-aliases/intentnotsubmittedreason/); `status`: `"not_submitted"`; \}

#### reason

> `readonly` **reason**: [`IntentNotSubmittedReason`](/reference/client/type-aliases/intentnotsubmittedreason/)

Stable admission or lifetime refusal.

#### status

> `readonly` **status**: `"not_submitted"`

Engine submission never began.

***

### Type Literal

\{ `error`: `Error`; `status`: `"failed"` \| `"unknown"`; \}

#### error

> `readonly` **error**: `Error`

Original error, preserved for authentication/error presentation.

#### status

> `readonly` **status**: `"failed"` \| `"unknown"`

Failed means known pre-side-effect refusal; unknown includes partial application and transport uncertainty.
