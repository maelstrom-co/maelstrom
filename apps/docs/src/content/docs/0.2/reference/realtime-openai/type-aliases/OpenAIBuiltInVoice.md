---
editUrl: false
next: false
prev: false
title: "OpenAIBuiltInVoice"
---

> **OpenAIBuiltInVoice** = `"alloy"` \| `"ash"` \| `"ballad"` \| `"coral"` \| `"echo"` \| `"sage"` \| `"shimmer"` \| `"verse"` \| `"marin"` \| `"cedar"`

Defined in: packages/realtime-protocol/dist/openai.d.ts:16

Built-in voice names accepted by both OpenAI Realtime output and greeting
TTS.

Every member must remain supported by both APIs. Keep this union limited to
that intersection so a configured voice cannot succeed on one speech path
and fail on the other.
