---
editUrl: false
next: false
prev: false
title: "OpenAITokenGrantSchema"
---

> `const` **OpenAITokenGrantSchema**: `ZodObject`\<\{ `expiresAt`: `ZodPipe`\<`ZodNumber`, `ZodTransform`\<[`UnixSeconds`](/reference/realtime-protocol/packages/realtime-protocol/src/type-aliases/unixseconds/), `number`\>\>; `model`: `ZodString`; `provider`: `ZodLiteral`\<`"openai"`\>; `value`: `ZodString`; \}, `$strip`\>

Defined in: packages/realtime-protocol/src/lib/openai-token.ts:58

Wire schema for [OpenAITokenGrant](/reference/realtime-protocol/packages/realtime-protocol/src/openai/interfaces/openaitokengrant/) — validates the mint endpoint's
response as it crosses the server → browser boundary.

- `value` must be a non-empty string (the opaque provider credential).
- `expiresAt` must satisfy [UnixSecondsSchema](/reference/realtime-protocol/packages/realtime-protocol/src/variables/unixsecondsschema/).
- `model` must be a non-empty string.
