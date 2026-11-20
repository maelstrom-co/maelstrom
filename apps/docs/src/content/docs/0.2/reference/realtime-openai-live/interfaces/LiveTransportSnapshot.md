---
editUrl: false
next: false
prev: false
title: "LiveTransportSnapshot"
---

Defined in: packages/realtime-openai-live/src/live-transport.ts:59

Retained lifecycle and final provider evidence for the latest explicit attempt.
Project diagnostic fields explicitly; the native final event can contain session configuration and provider content.

## Properties

### closedEvent?

> `readonly` `optional` **closedEvent?**: `LiveServerEvent`

Defined in: packages/realtime-openai-live/src/live-transport.ts:81

Native final event, including reason and session configuration snapshot.

***

### contextUsageRatio?

> `readonly` `optional` **contextUsageRatio?**: `number`

Defined in: packages/realtime-openai-live/src/live-transport.ts:75

Distinct context utilization observation.

***

### finalization

> `readonly` **finalization**: `"incomplete"` \| `"pending"` \| `"confirmed"`

Defined in: packages/realtime-openai-live/src/live-transport.ts:79

A lost transport or timeout leaves finalization incomplete.

***

### finalUsageSeconds?

> `readonly` `optional` **finalUsageSeconds?**: `number`

Defined in: packages/realtime-openai-live/src/live-transport.ts:77

Final usage only exists after a validated session.closed.

***

### generation

> `readonly` **generation**: `number`

Defined in: packages/realtime-openai-live/src/live-transport.ts:61

Local attempt identity.

***

### playback

> `readonly` **playback**: `"pending"` \| `"unavailable"` \| `"accepted"` \| `"blocked"`

Defined in: packages/realtime-openai-live/src/live-transport.ts:83

Play acceptance does not prove audibility. Blocked playback needs a user action.

***

### sessionId?

> `readonly` `optional` **sessionId?**: `string`

Defined in: packages/realtime-openai-live/src/live-transport.ts:71

Opaque provider session identity, when known.

***

### state

> `readonly` **state**: `"idle"` \| `"connecting"` \| `"connected"` \| `"closing"` \| `"closed"` \| `"error"`

Defined in: packages/realtime-openai-live/src/live-transport.ts:63

Transport lifecycle independent of voice activity.

***

### usageSeconds?

> `readonly` `optional` **usageSeconds?**: `number`

Defined in: packages/realtime-openai-live/src/live-transport.ts:73

Latest cumulative voice duration, never a sum of updates.
