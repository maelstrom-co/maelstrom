---
editUrl: false
next: false
prev: false
title: "LiveServerEventSchema"
---

> `const` **LiveServerEventSchema**: `ZodIntersection`\<`ZodRecord`\<`ZodString`, `ZodJSONSchema`\>, `ZodObject`\<\{ `event_id`: `ZodString`; `type`: `ZodString`; \}, `$strip`\>\>

Defined in: packages/realtime-protocol/src/openai-live.ts:279

Validates the envelope while retaining native fields, including future nested Responses events.
