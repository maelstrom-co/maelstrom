---
editUrl: false
next: false
prev: false
title: "AdapterDiagnosticResponse"
---

> **AdapterDiagnosticResponse** = \{ `id`: `string`; `phase`: `"started"` \| `"observed"`; \} \| \{ `id`: `string`; `outcome?`: `"succeeded"` \| `"failed"` \| `"cancelled"` \| `"incomplete"`; `phase`: `"finished"`; \}

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:262

Provider-reported response identity and lifecycle, independent of native event names.

## Union Members

### Type Literal

\{ `id`: `string`; `phase`: `"started"` \| `"observed"`; \}

#### id

> `readonly` **id**: `string`

Opaque response identity within the provider lifetime and generation.

#### phase

> `readonly` **phase**: `"started"` \| `"observed"`

Start or intermediate evidence; neither establishes a terminal outcome.

***

### Type Literal

\{ `id`: `string`; `outcome?`: `"succeeded"` \| `"failed"` \| `"cancelled"` \| `"incomplete"`; `phase`: `"finished"`; \}

#### id

> `readonly` **id**: `string`

Opaque response identity within the provider lifetime and generation.

#### outcome?

> `readonly` `optional` **outcome?**: `"succeeded"` \| `"failed"` \| `"cancelled"` \| `"incomplete"`

Reported terminal outcome; omission preserves an unknown result.

#### phase

> `readonly` **phase**: `"finished"`

Provider response processing ended; audio completion remains independent.
