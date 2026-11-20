---
editUrl: false
next: false
prev: false
title: "MaelstromResponseMessageSchema"
---

> `const` **MaelstromResponseMessageSchema**: `ZodObject`\<\{ `requestId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `response`: `ZodObject`\<\{ `executionPlan`: `ZodArray`\<`ZodObject`\<\{ `action`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ActionName`](/reference/protocol/type-aliases/actionname/), `string`\>\>; `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`InstanceId`](/reference/protocol/type-aliases/instanceid/), `string`\>\>; `params`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodUnknown`\>\>; \}, `$strip`\>\>; `layout`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `positions`: `ZodArray`\<`ZodObject`\<\{ `instanceId`: ...; `position`: ...; `size`: ...; \}, `$strip`\>\>; `type`: `ZodLiteral`\<`"grid"`\>; \}, `$strip`\>, `ZodObject`\<\{ `instances`: `ZodArray`\<`ZodObject`\<\{ `instanceId`: ...; `variant`: ...; `vesselId`: ...; \}, `$strip`\>\>; `tree`: `ZodArray`\<`ZodPipe`\<`ZodNullable`\<...\>, `ZodTransform`\<..., ...\>\>\>; `type`: `ZodLiteral`\<`"tiling"`\>; \}, `$strip`\>\], `"type"`\>; `rationale`: `ZodString`; `requestId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `type`: `ZodLiteral`\<`"maelstrom_response"`\>; `userMessage`: `ZodString`; \}, `$strip`\>; `sessionId`: `ZodOptional`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>\>; `type`: `ZodLiteral`\<`"engine.maelstrom.response"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/envelope.ts:248

Wire-format Zod parser for [MaelstromResponseMessage](/reference/protocol/variables/maelstromresponsemessage/). Validates the
discriminator, the branded `requestId`, the optional `sessionId`, and the
inner [MaelstromResponse](/reference/protocol/interfaces/maelstromresponse/) payload in one pass.
