---
editUrl: false
next: false
prev: false
title: "OpenAITokenRequestSchema"
---

> `const` **OpenAITokenRequestSchema**: `z.ZodObject`\<\{ `model`: `z.ZodOptional`\<`z.ZodString`\>; `provider`: `z.ZodLiteral`\<`"openai"`\>; `sessionId`: `z.ZodPipe`\<`z.ZodString`, `z.ZodTransform`\<`SessionId`, `string`\>\>; \}, `z.core.$strip`\>

Defined in: packages/realtime-protocol/dist/lib/openai-token.d.ts:25

Wire schema for [OpenAITokenRequest](/reference/realtime-openai/interfaces/openaitokenrequest/) — validates the request as it
crosses the browser → mint-endpoint boundary.

- `sessionId` must satisfy SessionIdSchema, binding the request to
  a specific Maelstrom session.
- `model`, when present, must be non-empty: an empty string is rejected
  rather than treated as "omitted".
