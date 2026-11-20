---
editUrl: false
next: false
prev: false
title: "LiveSessionExchange"
---

> **LiveSessionExchange** = (`request`, `signal`) => `Promise`\<[`LiveExchangeResponse`](/reference/realtime-protocol/packages/realtime-protocol/src/openai-live/interfaces/liveexchangeresponse/)\>

Defined in: packages/realtime-protocol/src/openai-live.ts:226

Host-owned exchange; cancellation never proves that upstream creation did not occur.

## Parameters

### request

[`LiveExchangeRequest`](/reference/realtime-protocol/packages/realtime-protocol/src/openai-live/interfaces/liveexchangerequest/)

### signal

`AbortSignal`

## Returns

`Promise`\<[`LiveExchangeResponse`](/reference/realtime-protocol/packages/realtime-protocol/src/openai-live/interfaces/liveexchangeresponse/)\>
