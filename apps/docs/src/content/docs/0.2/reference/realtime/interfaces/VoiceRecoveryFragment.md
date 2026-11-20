---
editUrl: false
next: false
prev: false
title: "VoiceRecoveryFragment"
---

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:41

A bounded excerpt of observed speech, never an invented complete turn.

## Properties

### connectionId

> `readonly` **connectionId**: `string`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:43

Unique local connection identity, including across provider recreation.

***

### endMs

> `readonly` **endMs**: `number`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:55

Exclusive provider timeline end, in milliseconds.

***

### id

> `readonly` **id**: `string`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:45

Provider-local fragment identity.

***

### role

> `readonly` **role**: `"user"` \| `"assistant"`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:47

Observed speaker role.

***

### startMs

> `readonly` **startMs**: `number`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:53

Inclusive provider timeline start, in milliseconds.

***

### text

> `readonly` **text**: `string`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:49

Exact observed text prefix, limited to 256 characters.

***

### truncated

> `readonly` **truncated**: `boolean`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session-memory.ts:51

Whether text was omitted from this excerpt.
