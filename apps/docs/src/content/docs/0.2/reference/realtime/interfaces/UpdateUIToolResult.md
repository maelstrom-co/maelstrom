---
editUrl: false
next: false
prev: false
title: "UpdateUIToolResult"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:160

Result of a settled `update_ui` tool call, as `RealtimeSession` hands it to
[RealtimeProviderAdapter.sendToolResult](/reference/realtime/interfaces/realtimeprovideradapter/#sendtoolresult). Both speak-worthy fields are
carried separately rather than pre-collapsed to one string, because each
transport phrases the reply differently: a speech-native provider (OpenAI)
posts the whole object and lets its own model choose the wording from both,
while a cascaded TTS provider (LiveKit) has no model and speaks
`userMessage ?? summary` verbatim.

Keeping the fields typed here is the point of the type: renaming one is a
compile error in every adapter that reads it, never a silent empty utterance.

## Properties

### ok

> `readonly` **ok**: `boolean`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:165

Whether the intent applied. `false` carries a user-facing `summary`
explaining why (bad request, render failure, still busy).

***

### summary?

> `readonly` `optional` **summary?**: `string`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:171

Structural description derived from the post-render snapshot. Always
present for a settled call; the fallback an adapter speaks when the engine
surfaced no `userMessage`.

***

### userMessage?

> `readonly` `optional` **userMessage?**: `string`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:177

The engine LLM's own conversational reply, already phrased for speech.
Preferred over `summary` when present; absent (or empty/whitespace) when
the engine produced no reply.
