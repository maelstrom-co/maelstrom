---
editUrl: false
next: false
prev: false
title: "ToolCallId"
---

> **ToolCallId** = [`Brand`](/reference/protocol/type-aliases/brand/)\<`string`, `"ToolCallId"`\>

Defined in: packages/protocol/src/lib/tool-call-id.ts:11

Opaque identifier assigned by a realtime provider (OpenAI, Google, …) to a
single tool call, correlating that call with the tool result sent back for
it. Format is intentionally unspecified — Maelstrom treats it as an opaque
string minted by the provider, never by the client.
