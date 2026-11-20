---
editUrl: false
next: false
prev: false
title: "VoiceRecoverySnapshot"
---

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:31

Bounded in-memory recovery evidence. Fragments are observations, never final turns or proof of audibility.

## Properties

### fragments

> `readonly` **fragments**: readonly [`VoiceRecoveryFragment`](/reference/realtime/interfaces/voicerecoveryfragment/)[]

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:35

Most recent eight observed fragments, with connection-local timing.

***

### introductionAttempted

> `readonly` **introductionAttempted**: `boolean`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:33

Whether a generated opening or fixed greeting was attempted, including ambiguous failures.

***

### outcomes

> `readonly` **outcomes**: readonly [`VoiceRecoveryOutcome`](/reference/realtime/interfaces/voicerecoveryoutcome/)[]

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:37

Most recent eight voice UI requests. Older records may be omitted, never replayed.
