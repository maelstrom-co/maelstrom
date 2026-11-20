---
editUrl: false
next: false
prev: false
title: "RunId"
---

> **RunId** = [`Brand`](/reference/protocol/type-aliases/brand/)\<`string`, `"RunId"`\>

Defined in: packages/protocol/src/lib/agent-ids.ts:10

Identifies one Agent Run: a single pass of the agent loop from the input
that starts it to its `finished` event. Every event a run emits carries it,
so a client can group streamed text, UI changes and the outcome by run.
