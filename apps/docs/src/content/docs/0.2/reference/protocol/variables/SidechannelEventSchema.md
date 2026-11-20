---
editUrl: false
next: false
prev: false
title: "SidechannelEventSchema"
---

> `const` **SidechannelEventSchema**: `ZodReadonly`\<`ZodDiscriminatedUnion`\<\[`ZodObject`\<\{ `at`: `ZodNumber`; `final`: `ZodBoolean`; `role`: `ZodEnum`\<\{ `assistant`: `"assistant"`; `user`: `"user"`; \}\>; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `text`: `ZodString`; `type`: `ZodLiteral`\<`"transcript"`\>; \}, `$strip`\>, `ZodObject`\<\{ `argumentsJson`: `ZodString`; `at`: `ZodNumber`; `callId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ToolCallId`](/reference/protocol/type-aliases/toolcallid/), `string`\>\>; `name`: `ZodString`; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `type`: `ZodLiteral`\<`"tool_call"`\>; \}, `$strip`\>, `ZodObject`\<\{ `at`: `ZodNumber`; `callId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`ToolCallId`](/reference/protocol/type-aliases/toolcallid/), `string`\>\>; `latencyMs`: `ZodNumber`; `ok`: `ZodBoolean`; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `type`: `ZodLiteral`\<`"tool_result"`\>; \}, `$strip`\>, `ZodObject`\<\{ `at`: `ZodNumber`; `label`: `ZodString`; `ms`: `ZodNumber`; `sessionId`: `ZodPipe`\<`ZodString`, `ZodTransform`\<[`SessionId`](/reference/protocol/type-aliases/sessionid/), `string`\>\>; `type`: `ZodLiteral`\<`"timing"`\>; \}, `$strip`\>\], `"type"`\>\>

Defined in: packages/protocol/src/lib/sidechannel-event.ts:28

The transcript/event stream the client emits to the consumer's backend for
observability (metering, recording, debugging). Intentionally carries **no
audio** — only transcripts, tool-call metadata, and timings. This is the
exact contract the cloud tier's metering later rides on, so additive-only.

`at` on each event is client-clock time and drifts across clients. Any
receiver that needs a trustworthy clock for cross-client ordering,
metering, or billing must stamp its own receipt time on ingest and use
that instead — `at` is diagnostic only.
