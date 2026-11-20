---
editUrl: false
next: false
prev: false
title: "ContinuousTranscriptOptions"
---

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:205

Bounded continuous caption retention and display policy; no timer creates
semantic finality. Invalid values throw RangeError synchronously when
constructing RealtimeSession.

## Properties

### groupGapMs?

> `readonly` `optional` **groupGapMs?**: `number`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:215

Maximum gap between same-speaker fragments in a display group, finite and at least zero. Defaults to 1000 milliseconds.

***

### maxFragmentChars?

> `readonly` `optional` **maxFragmentChars?**: `number`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:213

Maximum characters per fragment, a positive safe integer. Defaults to 16384.
Oversized text is rejected, never truncated. Valid completion metadata can
still finish an already retained partial caption without replacing its text.

***

### maxFragments?

> `readonly` `optional` **maxFragments?**: `number`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:207

Maximum retained fragments, a positive safe integer. Defaults to 256.
