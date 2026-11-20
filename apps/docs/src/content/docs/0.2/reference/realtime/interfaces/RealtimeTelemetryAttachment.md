---
editUrl: false
next: false
prev: false
title: "RealtimeTelemetryAttachment"
---

Defined in: packages/realtime/src/lib/diagnostics.ts:51

Explicit operational observation of one existing voice session.

## Properties

### drainTimeoutMs?

> `readonly` `optional` **drainTimeoutMs?**: `number`

Defined in: packages/realtime/src/lib/diagnostics.ts:61

Maximum retirement drain time, from 1 to 60,000 milliseconds. Defaults to 30,000; abandoned observations report source loss.

***

### maxPendingTools?

> `readonly` `optional` **maxPendingTools?**: `number`

Defined in: packages/realtime/src/lib/diagnostics.ts:59

Maximum accepted pending tool observations, from 1 to 65,536. Defaults to 1,000; excess calls report source loss.

***

### providerCategory?

> `readonly` `optional` **providerCategory?**: `"openai-live"` \| `"openai-realtime"` \| `"livekit"` \| `"custom"`

Defined in: packages/realtime/src/lib/diagnostics.ts:57

Fixed application-selected category captured for this lifetime; omission preserves unknown provider.

***

### session

> `readonly` **session**: `Pick`\<[`RealtimeSession`](/reference/realtime/classes/realtimesession/), `"events"`\>

Defined in: packages/realtime/src/lib/diagnostics.ts:53

Existing session; attachment never connects it or acquires media.

***

### telemetry?

> `readonly` `optional` **telemetry?**: `Telemetry`

Defined in: packages/realtime/src/lib/diagnostics.ts:55

Application-owned delivery lifetime. Omission or disabled telemetry does not subscribe.
