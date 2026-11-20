---
editUrl: false
next: false
prev: false
title: "OpenAITokenRequestSchema"
---

> `const` **OpenAITokenRequestSchema**: `ZodObject`\<\{ `model`: `ZodOptional`\<`ZodString`\>; `provider`: `ZodLiteral`\<`"openai"`\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<`SessionId`, `string`\>\>; \}, `$strip`\>

Defined in: packages/realtime-protocol/src/lib/openai-token.ts:29

Wire schema for [OpenAITokenRequest](/reference/realtime-protocol/packages/realtime-protocol/src/openai/interfaces/openaitokenrequest/) — validates the request as it
crosses the browser → mint-endpoint boundary.

- `sessionId` must satisfy SessionIdSchema, binding the request to
  a specific Maelstrom session.
- `model`, when present, must be non-empty: an empty string is rejected
  rather than treated as "omitted".
