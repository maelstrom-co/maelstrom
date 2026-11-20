---
editUrl: false
next: false
prev: false
title: "LiveInputMessage"
---

> **LiveInputMessage** = `object` & \{ `content`: readonly \[\{ `text`: `string`; `type`: `"input_text"`; \}\]; `role`: `"developer"` \| `"user"`; \} \| \{ `content`: readonly \[\{ `text`: `string`; `type`: `"output_text"` \| `"text"`; \}\]; `role`: `"assistant"`; \}

Defined in: packages/realtime-protocol/src/openai-live.ts:76

Supported Live startup text message. Factual recovery data must not use the trusted developer role.

## Type Declaration

### type

> `readonly` **type**: `"message"`

Message discriminator.
