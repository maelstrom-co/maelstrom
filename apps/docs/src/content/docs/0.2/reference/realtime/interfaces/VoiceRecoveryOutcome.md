---
editUrl: false
next: false
prev: false
title: "VoiceRecoveryOutcome"
---

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:13

Evidence about a voice UI request, independent of provider delivery.

## Properties

### id

> `readonly` **id**: `ToolCallId`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:15

Local correlation only; never replayed as a provider function.

***

### intent

> `readonly` **intent**: `string`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:17

Bounded requested intent, not a spoken transcript.

***

### status

> `readonly` **status**: `"submitted"` \| `"queued"` \| `"completed"` \| `"failed"` \| `"unknown"` \| `"not_submitted"`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:19

Unknown does not authorize a retry. Submitted work can still finish after voice ends.

***

### summary?

> `readonly` `optional` **summary?**: `string`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:27

Bounded application evidence; absence does not mean success.
