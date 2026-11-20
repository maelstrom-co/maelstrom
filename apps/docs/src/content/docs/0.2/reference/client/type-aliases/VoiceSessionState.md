---
editUrl: false
next: false
prev: false
title: "VoiceSessionState"
---

> **VoiceSessionState** = `"idle"` \| `"connecting"` \| `"connected"` \| `"listening"` \| `"thinking"` \| `"speaking"` \| `"error"`

Defined in: packages/client/src/lib/voice-session/voice-session.types.ts:11

UI-facing lifecycle state common to every voice implementation. `idle` is
"not connected" (before `connect()` and after `disconnect()`); `connected`
is the transport being live but not yet in an active listening/thinking/
speaking turn — collapsing it into `idle` would make a live session
indistinguishable from a disconnected one.
