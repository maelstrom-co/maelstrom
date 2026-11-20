---
editUrl: false
next: false
prev: false
title: "AgentInputMessageSchema"
---

> `const` **AgentInputMessageSchema**: `ZodObject`\<\{ `id`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `input`: `ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `chart`: `ZodType`\<[`ChartRequest`](/reference/protocol/interfaces/chartrequest/), `unknown`, `$ZodTypeInternals`\<[`ChartRequest`](/reference/protocol/interfaces/chartrequest/), `unknown`\>\>; `inputId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `source`: `ZodEnum`\<\{ `text`: `"text"`; `voice`: `"voice"`; \}\>; `text`: `ZodString`; `type`: `ZodLiteral`\<`"utterance"`\>; `version`: `ZodLiteral`\<`1`\>; \}, `$strip`\>, `ZodObject`\<\{ `actionOutcomes`: `ZodArray`\<`ZodObject`\<\{ `error`: `ZodOptional`\<`ZodString`\>; `ok`: `ZodBoolean`; \}, `$strip`\>\>; `changeId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ChangeId`](/reference/protocol/type-aliases/changeid/), `string`\>\>; `chart`: `ZodType`\<[`ChartRequest`](/reference/protocol/interfaces/chartrequest/), `unknown`, `$ZodTypeInternals`\<[`ChartRequest`](/reference/protocol/interfaces/chartrequest/), `unknown`\>\>; `type`: `ZodLiteral`\<`"ui_applied"`\>; `version`: `ZodLiteral`\<`1`\>; \}, `$strip`\>\], `"type"`\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `type`: `ZodLiteral`\<`"client.agent.input"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/envelope.ts:127

Wire-format Zod parser for [AgentInputMessage](/reference/protocol/variables/agentinputmessage/). Validates the
discriminator, the branded `id` / `sessionId`, and the inner
[AgentInput](/reference/protocol/type-aliases/agentinput/), including its `version`.
