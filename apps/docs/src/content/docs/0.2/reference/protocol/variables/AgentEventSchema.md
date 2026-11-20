---
editUrl: false
next: false
prev: false
title: "AgentEventSchema"
---

> `const` **AgentEventSchema**: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `inputId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `text`: `ZodString`; `type`: `ZodLiteral`\<`"placeholder"`\>; `version`: `ZodLiteral`\<`1`\>; \}, `$strip`\>, `ZodObject`\<\{ `ack`: `ZodString`; `disposition`: `ZodEnum`\<\{ `agent`: `"agent"`; `amend`: `"amend"`; `answer`: `"answer"`; `independent`: `"independent"`; `noise`: `"noise"`; `supersede`: `"supersede"`; `ui_only`: `"ui_only"`; \}\>; `inputId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `runId`: `ZodNullable`\<`ZodPipe`\<`ZodString`, `ZodTransform`\<[`RunId`](/reference/protocol/type-aliases/runid/), `string`\>\>\>; `type`: `ZodLiteral`\<`"accepted"`\>; `version`: `ZodLiteral`\<`1`\>; \}, `$strip`\>, `ZodObject`\<\{ `delta`: `ZodString`; `runId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`RunId`](/reference/protocol/type-aliases/runid/), `string`\>\>; `turnId`: `ZodString`; `type`: `ZodLiteral`\<`"message"`\>; `version`: `ZodLiteral`\<`1`\>; \}, `$strip`\>\], `"type"`\>

Defined in: packages/protocol/src/lib/agent-wire.ts:401

Every event the Engine may send on the agent event stream, discriminated on
`type`. Each member carries `version` equal to [AGENT\_WIRE\_VERSION](/reference/protocol/variables/agent_wire_version/).
