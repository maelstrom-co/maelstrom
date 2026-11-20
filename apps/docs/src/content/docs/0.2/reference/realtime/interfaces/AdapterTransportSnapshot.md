---
editUrl: false
next: false
prev: false
title: "AdapterTransportSnapshot"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:301

Provider-neutral transport facts available for diagnostic projection.

## Properties

### contextUsageRatio?

> `readonly` `optional` **contextUsageRatio?**: `number`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:311

Reported context fraction when available.

***

### finalization?

> `readonly` `optional` **finalization?**: `string`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:313

Provider finalization state when available.

***

### finalUsageSeconds?

> `readonly` `optional` **finalUsageSeconds?**: `number`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:309

Reported final usage when available.

***

### generation

> `readonly` **generation**: `number`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:303

Native attempt count, independent of the session's generation.

***

### playback?

> `readonly` `optional` **playback?**: `string`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:315

Playback acceptance state when available; not proof of audibility.

***

### state

> `readonly` **state**: `string`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:305

Provider-reported lifecycle state.

***

### usageSeconds?

> `readonly` `optional` **usageSeconds?**: `number`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:307

Reported cumulative usage when available.
