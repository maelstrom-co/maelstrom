---
editUrl: false
next: false
prev: false
title: "RealtimeSessionOptions"
---

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:154

Options for constructing a [RealtimeSession](/reference/realtime/classes/realtimesession/).

## Properties

### adapter

> `readonly` **adapter**: [`RealtimeProviderAdapter`](/reference/realtime/interfaces/realtimeprovideradapter/)

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:163

***

### conversationInstructions?

> `readonly` `optional` **conversationInstructions?**: `string`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:160

Conversation-only instructions for adapters with a separate managed tool backend.

***

### debug?

> `readonly` `optional` **debug?**: `boolean`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:182

Enable verbose debug tracing (default false).

***

### generatedOpening?

> `readonly` `optional` **generatedOpening?**: `object`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:158

Optional natural introduction. One attempt per memory lifetime; use an explicit language in these trusted instructions. Cannot accompany a fixed greeting.

#### instructions

> `readonly` **instructions**: `string`

***

### greeting?

> `readonly` `optional` **greeting?**: `object`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:194

Optional one-shot spoken greeting. The coordinator is owned by the
maelstrom-realtime layer (one per Orchestrator) so session recreation
reuses retained proofs. Never constructed inside [RealtimeSession](/reference/realtime/classes/realtimesession/).

The greeting shares the once-per-memory introduction with
`generatedOpening`: it claims the memory right before speech is sent, and
an introduction another opening already claimed in the same memory, for
example before a provider switch, settles it without speaking. Retries
after its own `not_started` attempts still follow the coordinator.

#### coordinator

> `readonly` **coordinator**: [`GreetingCoordinator`](/reference/realtime/classes/greetingcoordinator/)

#### text

> `readonly` **text**: `string`

***

### groundingDebounceMs?

> `readonly` `optional` **groundingDebounceMs?**: `number`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:172

Debounce window for latest-wins grounding pushes. Defaults to 1000ms.

***

### instance

> `readonly` **instance**: [`RealtimeInstance`](/reference/realtime/interfaces/realtimeinstance/)

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:164

***

### memory?

> `readonly` `optional` **memory?**: [`RealtimeSessionMemory`](/reference/realtime/classes/realtimesessionmemory/)

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:156

Shared evidence owner for this sessionId. Retain across provider/session recreation; React supplies it automatically.

***

### onEvent?

> `readonly` `optional` **onEvent?**: (`event`) => `void`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:180

Observes the stable, additive-only SidechannelEvent stream: tool
calls and results, legacy and greeting transcripts, and `update_ui`
timings. It is served by a subscriber on the session's event stream, so a
throwing observer is isolated and logged. Turn-mode changes are excluded.

#### Parameters

##### event

`Readonly`\<\{ `at`: `number`; `final`: `boolean`; `role`: `"user"` \| `"assistant"`; `sessionId`: `SessionId`; `text`: `string`; `type`: `"transcript"`; \}\> \| `Readonly`\<\{ `argumentsJson`: `string`; `at`: `number`; `callId`: `ToolCallId`; `name`: `string`; `sessionId`: `SessionId`; `type`: `"tool_call"`; \}\> \| `Readonly`\<\{ `at`: `number`; `callId`: `ToolCallId`; `latencyMs`: `number`; `ok`: `boolean`; `sessionId`: `SessionId`; `type`: `"tool_result"`; \}\> \| `Readonly`\<\{ `at`: `number`; `label`: `string`; `ms`: `number`; `sessionId`: `SessionId`; `type`: `"timing"`; \}\>

#### Returns

`void`

***

### sessionId

> `readonly` **sessionId**: `SessionId`

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:170

Maelstrom session this realtime session belongs to. Stamped onto every
emitted SidechannelEvent. Must match the session the `instance`
runs under (e.g. the Orchestrator's own session).

***

### summarize?

> `readonly` `optional` **summarize?**: [`SummarizeFn`](/reference/realtime/type-aliases/summarizefn/)

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:173

***

### transcript?

> `readonly` `optional` **transcript?**: [`ContinuousTranscriptOptions`](/reference/realtime/interfaces/continuoustranscriptoptions/)

Defined in: packages/realtime/src/lib/realtime-session/realtime-session.types.ts:162

Bounds and display grouping policy for the continuous transcript channel.
