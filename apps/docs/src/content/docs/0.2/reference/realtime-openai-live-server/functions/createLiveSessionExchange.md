---
editUrl: false
next: false
prev: false
title: "createLiveSessionExchange"
---

> **createLiveSessionExchange**(`options`): `LiveSessionExchange`

Defined in: packages/realtime-openai-live-server/src/index.ts:23

Creates a single-attempt exchange against OpenAI's fixed HTTPS endpoint.
The wrapping host route owns authentication, authorization, configuration policy,
HTTPS, and rate limits. Cancellation cannot undo an already-created paid session.

## Parameters

### options

[`LiveSessionExchangeOptions`](/reference/realtime-openai-live-server/interfaces/livesessionexchangeoptions/)

## Returns

`LiveSessionExchange`
