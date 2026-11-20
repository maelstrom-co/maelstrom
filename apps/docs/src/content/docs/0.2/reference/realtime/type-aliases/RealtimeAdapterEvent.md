---
editUrl: false
next: false
prev: false
title: "RealtimeAdapterEvent"
---

> **RealtimeAdapterEvent** = \{ `argumentsJson`: `string`; `callId`: `ToolCallId`; `name`: `string`; `type`: `"tool_call"`; \} \| \{ `final`: `boolean`; `role`: `"user"` \| `"assistant"`; `text`: `string`; `type`: `"transcript"`; \} \| \{ `type`: `"speech_started"`; \} \| \{ `state`: `VoiceSessionState`; `type`: `"state"`; \} \| [`TurnModeEvent`](/reference/realtime/interfaces/turnmodeevent/) \| \{ `error`: `unknown`; `type`: `"error"`; \}

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:80

Legacy events a `RealtimeProviderAdapter` emits toward `RealtimeSession`.
Continuous media and timestamped fragments use the separate
[AdapterVoiceObservations](/reference/realtime/interfaces/adaptervoiceobservations/) channel, preserving exhaustive consumers.

## Union Members

### Type Literal

\{ `argumentsJson`: `string`; `callId`: `ToolCallId`; `name`: `string`; `type`: `"tool_call"`; \}

***

### Type Literal

\{ `final`: `boolean`; `role`: `"user"` \| `"assistant"`; `text`: `string`; `type`: `"transcript"`; \}

***

### Type Literal

\{ `type`: `"speech_started"`; \}

***

### Type Literal

\{ `state`: `VoiceSessionState`; `type`: `"state"`; \}

#### state

> `readonly` **state**: `VoiceSessionState`

`idle` ends the connection lifetime and retires pending voice work;
`connected` means live turn-idle and does not retire work. Bare `error`
preserves startup presentation; runtime connection failures must emit
an error event carrying RealtimeVoiceError for terminal cleanup.

#### type

> `readonly` **type**: `"state"`

UI-facing provider lifecycle or turn activity.

***

[`TurnModeEvent`](/reference/realtime/interfaces/turnmodeevent/)

***

### Type Literal

\{ `error`: `unknown`; `type`: `"error"`; \}
