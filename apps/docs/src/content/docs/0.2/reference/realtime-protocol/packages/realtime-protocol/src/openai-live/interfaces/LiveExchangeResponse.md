---
editUrl: false
next: false
prev: false
title: "LiveExchangeResponse"
---

Defined in: packages/realtime-protocol/src/openai-live.ts:194

Validated HTTP session creation result. IDs are opaque and retained unchanged.

## Properties

### session

> `readonly` **session**: `object`

Defined in: packages/realtime-protocol/src/openai-live.ts:196

Created session identity.

#### id

> `readonly` **id**: `string`

Opaque upstream identity.

***

### transport

> `readonly` **transport**: [`LiveWebRTCDescription`](/reference/realtime-protocol/packages/realtime-protocol/src/openai-live/interfaces/livewebrtcdescription/)

Defined in: packages/realtime-protocol/src/openai-live.ts:201

WebRTC answer.
