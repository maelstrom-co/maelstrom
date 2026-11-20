---
editUrl: false
next: false
prev: false
title: "AssistantInjectionMessageSchema"
---

> `const` **AssistantInjectionMessageSchema**: `ZodObject`\<\{ `content`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `timestamp`: `ZodNumber`; `type`: `ZodLiteral`\<`"assistant_message"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/engine-message.ts:139

Wire-format Zod parser for [AssistantInjectionMessage](/reference/protocol/variables/assistantinjectionmessage/) envelopes.
Validates the discriminator, all envelope-level fields, and requires
`content` to be a non-empty string.
