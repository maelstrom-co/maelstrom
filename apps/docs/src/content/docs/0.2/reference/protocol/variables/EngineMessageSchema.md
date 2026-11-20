---
editUrl: false
next: false
prev: false
title: "EngineMessageSchema"
---

> `const` **EngineMessageSchema**: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `request`: `ZodObject`\<\{ `context`: `ZodObject`\<\{ `chartDimensions`: `ZodObject`\<\{ `columns`: `ZodNumber`; `rows`: `ZodNumber`; \}, `$strip`\>; `layoutMode`: `ZodEnum`\<\{ `grid`: `"grid"`; `tiling`: `"tiling"`; \}\>; `updateReasons`: `ZodArray`\<`ZodDiscriminatedUnion`\<\[..., ..., ...\], `"type"`\>\>; \}, `$strip`\>; `instances`: `ZodArray`\<`ZodObject`\<\{ `instanceId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<..., ...\>\>; `variant`: `ZodPipe`\<`ZodString`, `ZodTransform`\<..., ...\>\>; `vesselId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<..., ...\>\>; \}, `$strip`\>\>; `intentFacts`: `ZodOptional`\<`ZodRecord`\<`ZodString`, `ZodType`\<`Mutable`\<[`JsonValue`](/reference/protocol/type-aliases/jsonvalue/)\>, `unknown`, `$ZodTypeInternals`\<`Mutable`\<...\>, `unknown`\>\>\>\>; `layout`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `positions`: `ZodArray`\<...\>; `type`: `ZodLiteral`\<...\>; \}, `$strip`\>, `ZodObject`\<\{ `instances`: `ZodArray`\<...\>; `tree`: `ZodArray`\<...\>; `type`: `ZodLiteral`\<...\>; \}, `$strip`\>\], `"type"`\>; `skipReply`: `ZodOptional`\<`ZodBoolean`\>; `type`: `ZodLiteral`\<`"chart_request"`\>; `vessels`: `ZodArray`\<`ZodObject`\<\{ `defaultVariant`: `ZodPipe`\<`ZodString`, `ZodTransform`\<..., ...\>\>; `description`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<..., ...\>\>; `name`: `ZodString`; `variants`: `ZodRecord`\<`ZodPipe`\<..., ...\>, `ZodObject`\<..., ...\>\>; \}, `$strip`\>\>; \}, `$strip`\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `timestamp`: `ZodNumber`; `type`: `ZodLiteral`\<`"chart_request"`\>; \}, `$strip`\>, `ZodObject`\<\{ `content`: `ZodString`; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `timestamp`: `ZodNumber`; `type`: `ZodLiteral`\<`"assistant_message"`\>; \}, `$strip`\>\], `"type"`\>

Defined in: packages/protocol/src/lib/engine-message.ts:150

Wire-format Zod parser for the [EngineMessage](/reference/protocol/type-aliases/enginemessage/) discriminated union.
Dispatches on the `type` field and delegates to the appropriate envelope
schema. Unknown discriminators are rejected with a Zod issue.
