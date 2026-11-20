---
editUrl: false
next: false
prev: false
title: "HistoryEntry"
---

> **HistoryEntry**\<`TMeta`\> = \{ `input`: `ChartRequestMessage`; `kind`: `"turn"`; `metadata?`: `TMeta`; `output`: `ChartResponseOutput`; \} \| \{ `input`: `AssistantInjectionMessage`; `kind`: `"injection"`; `metadata?`: `TMeta`; \}

Defined in: packages/engine/src/lib/history/history-store.ts:30

A single recorded item in a session's history.

`turn` entries capture a completed chart_request round-trip (LLM input + output).
`injection` entries capture a developer-supplied assistant message — content
seeded into history so subsequent LLM turns see it in context, without
actually invoking the LLM for the injection itself.

Engine-internal: this is the storage shape, persisted by the configured
[HistoryStore](/reference/engine/interfaces/historystore/) and consumed by the prompt-builder. Clients fetching
history through `Engine.getHistory` see a leaner wire DTO
(SessionHistoryEntry in `@maelstrom-co/protocol`); this internal
type is free to evolve (extra metadata fields, store-specific keys, etc.)
without breaking the wire contract.

Consumers may pin `TMeta` to attach typed metadata (tenant id, experiment
arm, token counts, audit trail, etc.) that rides along every entry and
flows through the store, the `transformEntry` hook, and any configured
`deriveLLMContext` projection. Leave the type parameter defaulted to
`unknown` to opt out of metadata entirely.

## Type Parameters

### TMeta

`TMeta` = `unknown`
