---
editUrl: false
next: false
prev: false
title: "LiveExchangeRequest"
---

Defined in: packages/realtime-protocol/src/openai-live.ts:186

Browser offer sent to a host exchange. The host must authorize the caller and configuration.

## Properties

### session

> `readonly` **session**: [`LiveSessionConfig`](/reference/realtime-protocol/packages/realtime-protocol/src/openai-live/interfaces/livesessionconfig/)

Defined in: packages/realtime-protocol/src/openai-live.ts:188

Requested session configuration; a server may replace it with trusted policy.

***

### transport

> `readonly` **transport**: [`LiveWebRTCDescription`](/reference/realtime-protocol/packages/realtime-protocol/src/openai-live/interfaces/livewebrtcdescription/)

Defined in: packages/realtime-protocol/src/openai-live.ts:190

Fully gathered WebRTC offer.
