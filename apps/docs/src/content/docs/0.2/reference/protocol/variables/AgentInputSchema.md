---
editUrl: false
next: false
prev: false
title: "AgentInputSchema"
---

> `const` **AgentInputSchema**: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `chart`: `ZodType`\<[`ChartRequest`](/reference/protocol/interfaces/chartrequest/), `unknown`, `$ZodTypeInternals`\<[`ChartRequest`](/reference/protocol/interfaces/chartrequest/), `unknown`\>\>; `inputId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `source`: `ZodEnum`\<\{ `text`: `"text"`; `voice`: `"voice"`; \}\>; `text`: `ZodString`; `type`: `ZodLiteral`\<`"utterance"`\>; `version`: `ZodLiteral`\<`1`\>; \}, `$strip`\>, `ZodObject`\<\{ `actionOutcomes`: `ZodArray`\<`ZodObject`\<\{ `error`: `ZodOptional`\<`ZodString`\>; `ok`: `ZodBoolean`; \}, `$strip`\>\>; `changeId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ChangeId`](/reference/protocol/type-aliases/changeid/), `string`\>\>; `chart`: `ZodType`\<[`ChartRequest`](/reference/protocol/interfaces/chartrequest/), `unknown`, `$ZodTypeInternals`\<[`ChartRequest`](/reference/protocol/interfaces/chartrequest/), `unknown`\>\>; `type`: `ZodLiteral`\<`"ui_applied"`\>; `version`: `ZodLiteral`\<`1`\>; \}, `$strip`\>\], `"type"`\>

Defined in: packages/protocol/src/lib/agent-wire.ts:176

Every input a client may send to the Agent Session, discriminated on
`type`. Each member carries `version` equal to [AGENT\_WIRE\_VERSION](/reference/protocol/variables/agent_wire_version/).
