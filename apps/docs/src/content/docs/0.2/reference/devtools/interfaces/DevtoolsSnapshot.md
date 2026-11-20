---
editUrl: false
next: false
prev: false
title: "DevtoolsSnapshot"
---

Defined in: packages/devtools/src/types.ts:50

Immutable external-store view of diagnostic state.

## Properties

### activity

> `readonly` **activity**: readonly `DiagnosticEvent`[]

Defined in: packages/devtools/src/types.ts:54

Recent metadata observations; application content is absent.

***

### droppedActivityEvents

> `readonly` **droppedActivityEvents**: `number`

Defined in: packages/devtools/src/types.ts:56

Number of older metadata events evicted from the recent-event buffer.

***

### droppedRequestEvents

> `readonly` **droppedRequestEvents**: `number`

Defined in: packages/devtools/src/types.ts:60

Number of request metadata events evicted from request history.

***

### imported

> `readonly` **imported**: `unknown`

Defined in: packages/devtools/src/types.ts:64

Capture opened for read-only inspection.

***

### requestActivity

> `readonly` **requestActivity**: readonly `DiagnosticEvent`[]

Defined in: packages/devtools/src/types.ts:58

Request metadata retained independently of recent activity; application content is absent.

***

### sessions

> `readonly` **sessions**: readonly [`DevtoolsSession`](/reference/devtools/interfaces/devtoolssession/)[]

Defined in: packages/devtools/src/types.ts:52

Isolated Provider lifetimes.

***

### transportHistory

> `readonly` **transportHistory**: readonly `DiagnosticEvent`[]

Defined in: packages/devtools/src/types.ts:62

Latest terminal transport summaries, retained independently of recent activity.
