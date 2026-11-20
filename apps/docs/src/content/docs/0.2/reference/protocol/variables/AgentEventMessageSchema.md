---
editUrl: false
next: false
prev: false
title: "AgentEventMessageSchema"
---

> `const` **AgentEventMessageSchema**: `ZodObject`\<\{ `event`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `inputId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `text`: `ZodString`; `type`: `ZodLiteral`\<`"placeholder"`\>; `version`: `ZodLiteral`\<`1`\>; \}, `$strip`\>, `ZodObject`\<\{ `ack`: `ZodString`; `disposition`: `ZodEnum`\<\{ `agent`: `"agent"`; `amend`: `"amend"`; `answer`: `"answer"`; `independent`: `"independent"`; `noise`: `"noise"`; `supersede`: `"supersede"`; `ui_only`: `"ui_only"`; \}\>; `inputId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `runId`: `ZodNullable`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<[`RunId`](/reference/protocol/type-aliases/runid/), `string`\>\>\>; `type`: `ZodLiteral`\<`"accepted"`\>; `version`: `ZodLiteral`\<`1`\>; \}, `$strip`\>, `ZodObject`\<\{ `delta`: `ZodString`; `runId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`RunId`](/reference/protocol/type-aliases/runid/), `string`\>\>; `turnId`: `ZodString`; `type`: `ZodLiteral`\<`"message"`\>; `version`: `ZodLiteral`\<`1`\>; \}, `$strip`\>\], `"type"`\>; `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `type`: `ZodLiteral`\<`"engine.agent.event"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/envelope.ts:398

Wire-format Zod parser for [AgentEventMessage](/reference/protocol/variables/agenteventmessage/). Validates the
discriminator, the branded `id` / `sessionId`, and the inner
[AgentEvent](/reference/protocol/type-aliases/agentevent/), including its `version`.
