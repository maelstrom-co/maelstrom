---
editUrl: false
next: false
prev: false
title: "MaelstromRealtimeBaseOptions"
---

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:106

Options shared by every opening configuration of [maelstromRealtime](/reference/react-realtime/functions/maelstromrealtime/).

## Type Parameters

### Provider

`Provider` = `undefined`

## Properties

### conversationInstructions?

> `readonly` `optional` **conversationInstructions?**: `string`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:124

Conversation-only instructions for providers with a separate managed tool backend.

***

### createAdapter

> `readonly` **createAdapter**: (`context`) => `RealtimeProviderAdapter`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:133

Builds one provider adapter for each shared session. The factory receives
the orchestrator session identifier and the provider, and is not called
per render or hook. If building the session fails after it returns, the
adapter is disconnected.

#### Parameters

##### context

[`CreateAdapterContext`](/reference/react-realtime/type-aliases/createadaptercontext/)\<`Provider`\>

#### Returns

`RealtimeProviderAdapter`

***

### debug?

> `readonly` `optional` **debug?**: `boolean`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:162

Enables verbose tracing in the underlying session.

***

### groundingDebounceMs?

> `readonly` `optional` **groundingDebounceMs?**: `number`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:154

Debounce window for latest-wins grounding pushes.

***

### initialProvider?

> `readonly` `optional` **initialProvider?**: `Provider` \| (() => `Provider`)

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:122

Provider of each Orchestrator's first session; defaults to the first
entry of `providers`. A function is read lazily, when that first session
is built. Afterwards the extension remembers the last chosen provider per
Orchestrator, so a remount keeps it.
When `providers` is set, the selection must belong to that list; an unknown
value throws `RangeError` before the first adapter is built.

***

### onEvent?

> `readonly` `optional` **onEvent?**: (`event`) => `void`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:160

Observes the stable, additive-only sidechannel stream of every session:
tool calls and results, transcripts and `update_ui` timings. Turn-mode
diagnostics are excluded.

#### Parameters

##### event

`Readonly`\<\{ `at`: `number`; `final`: `boolean`; `role`: `"user"` \| `"assistant"`; `sessionId`: `SessionId`; `text`: `string`; `type`: `"transcript"`; \}\> \| `Readonly`\<\{ `argumentsJson`: `string`; `at`: `number`; `callId`: `ToolCallId`; `name`: `string`; `sessionId`: `SessionId`; `type`: `"tool_call"`; \}\> \| `Readonly`\<\{ `at`: `number`; `callId`: `ToolCallId`; `latencyMs`: `number`; `ok`: `boolean`; `sessionId`: `SessionId`; `type`: `"tool_result"`; \}\> \| `Readonly`\<\{ `at`: `number`; `label`: `string`; `ms`: `number`; `sessionId`: `SessionId`; `type`: `"timing"`; \}\>

#### Returns

`void`

***

### onSession?

> `readonly` `optional` **onSession?**: (`session`, `context`) => `void` \| (() => `void`)

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:146

Attaches app wiring, such as diagnostics subscriptions on
RealtimeSession.events, to each session the extension builds. It
runs once per session, synchronously while the session is built, which
can happen during render, so it must not update React state directly.
An optional returned cleanup runs after the session has disconnected, when a
provider switch replaces it or its last consumer unmounts. Subscriptions
the cleanup leaves in place keep observing the retired session, which
still reports requests that settle late. Throwing aborts the build.

#### Parameters

##### session

`RealtimeSession`

##### context

[`RealtimeSessionContext`](/reference/react-realtime/interfaces/realtimesessioncontext/)\<`Provider`\>

#### Returns

`void` \| (() => `void`)

***

### providers?

> `readonly` `optional` **providers?**: readonly `Provider`[]

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:113

Voice providers this extension can switch between, for example
`['live', 'realtime']`. The list types
[UseVoiceResult.switchProvider](/reference/react-realtime/interfaces/usevoiceresult/#switchprovider), which rejects any other value.
An empty list throws `RangeError`. Omit it for a single-provider extension.

***

### summarize?

> `readonly` `optional` **summarize?**: `SummarizeFn`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:152

Overrides the deterministic structural-summary fallback.

***

### transcript?

> `readonly` `optional` **transcript?**: `ContinuousTranscriptOptions`

Defined in: packages/react-realtime/src/lib/maelstrom-realtime.ts:126

Bounds and grouping policy for the opt-in continuous transcript channel.
