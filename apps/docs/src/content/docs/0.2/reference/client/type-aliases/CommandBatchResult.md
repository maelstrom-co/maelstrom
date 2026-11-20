---
editUrl: false
next: false
prev: false
title: "CommandBatchResult"
---

> **CommandBatchResult** = \{ `status`: `"applied"`; \} \| \{ `error`: `Error`; `status`: `"failed"` \| `"unknown"`; \}

Defined in: packages/client/src/lib/command-processor/command-batch-result.ts:2

Outcome of one atomic command batch, independent of other queued commands.

## Union Members

### Type Literal

\{ `status`: `"applied"`; \}

#### status

> `readonly` **status**: `"applied"`

Every command and action completed successfully.

***

### Type Literal

\{ `error`: `Error`; `status`: `"failed"` \| `"unknown"`; \}

#### error

> `readonly` **error**: `Error`

Original refusal or execution error, when available.

#### status

> `readonly` **status**: `"failed"` \| `"unknown"`

`failed` is a first-layout refusal; partial, skipped or disposed work is `unknown`.
