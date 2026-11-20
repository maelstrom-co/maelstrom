---
editUrl: false
next: false
prev: false
title: "OpenAITokenGrantSchema"
---

> `const` **OpenAITokenGrantSchema**: `z.ZodObject`\<\{ `expiresAt`: `z.ZodPipe`\<`z.ZodNumber`, `z.ZodTransform`\<`UnixSeconds`, `number`\>\>; `model`: `z.ZodString`; `provider`: `z.ZodLiteral`\<`"openai"`\>; `value`: `z.ZodString`; \}, `z.core.$strip`\>

Defined in: packages/realtime-protocol/dist/lib/openai-token.d.ts:52

Wire schema for [OpenAITokenGrant](/reference/realtime-openai/interfaces/openaitokengrant/) — validates the mint endpoint's
response as it crosses the server → browser boundary.

- `value` must be a non-empty string (the opaque provider credential).
- `expiresAt` must satisfy UnixSecondsSchema.
- `model` must be a non-empty string.
