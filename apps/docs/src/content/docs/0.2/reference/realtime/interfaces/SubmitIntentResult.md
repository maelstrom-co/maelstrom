---
editUrl: false
next: false
prev: false
title: "SubmitIntentResult"
---

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:32

What submitting an intent tells the voice layer, narrowed to what it speaks.

`userMessage` is the engine LLM's conversational reply to the user — already
context-aware and phrased for speech (e.g. "Done — here are your labs")
rather than a structural description. When present it is spoken verbatim as
the `update_ui` tool result, taking precedence over the snapshot summarizer
(see [SummarizeFn](/reference/realtime/type-aliases/summarizefn/)). It is optional on the seam so an instance that
cannot surface an engine reply can omit it; the session then falls back to
summarizing the post-render snapshot. An empty or whitespace-only string is
treated the same as absent.

## Properties

### userMessage?

> `readonly` `optional` **userMessage?**: `string`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:33
