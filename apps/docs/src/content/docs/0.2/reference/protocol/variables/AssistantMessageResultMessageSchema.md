---
editUrl: false
next: false
prev: false
title: "AssistantMessageResultMessageSchema"
---

> `const` **AssistantMessageResultMessageSchema**: `ZodObject`\<\{ `outcome`: `ZodUnion`\<readonly \[`ZodLiteral`\<`"inserted"`\>, `ZodLiteral`\<`"deduped"`\>\]\>; `requestId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`MessageId`](/reference/protocol/type-aliases/messageid/), `string`\>\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `type`: `ZodLiteral`\<`"engine.assistant_message.result"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/envelope.ts:337

Wire-format Zod parser for [AssistantMessageResultMessage](/reference/protocol/variables/assistantmessageresultmessage/).

Validates the discriminator, branded `requestId` / `sessionId`, and the
closed `'inserted' | 'deduped'` outcome so consumers can trust correlation
and branching semantics at the decode boundary.
