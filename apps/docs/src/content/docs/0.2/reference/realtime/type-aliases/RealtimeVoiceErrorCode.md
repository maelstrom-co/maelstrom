---
editUrl: false
next: false
prev: false
title: "RealtimeVoiceErrorCode"
---

> **RealtimeVoiceErrorCode** = `"MIC_PERMISSION_DENIED"` \| `"TOKEN_MINT_FAILED"` \| `"CONNECTION_FAILED"` \| `"DATA_CHANNEL_ERROR"` \| `"ALREADY_CONNECTED"` \| `"CONNECT_SUPERSEDED"` \| `"GREETING_ADAPTER_UNSUPPORTED"`

Defined in: packages/realtime/src/lib/realtime-voice-error.ts:12

Programmatic causes for realtime voice failures. UIs switch on these to
show actionable recovery guidance (e.g. mic-permission help vs. key setup).

Every code names a **fatal** condition: a code exists only for failures that
warrant raising a [RealtimeVoiceError](/reference/realtime/classes/realtimevoiceerror/), which by contract tears the
session down. Non-fatal failures carry no code — see the severity contract
on [RealtimeVoiceError](/reference/realtime/classes/realtimevoiceerror/).
