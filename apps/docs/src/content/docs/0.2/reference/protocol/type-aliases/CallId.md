---
editUrl: false
next: false
prev: false
title: "CallId"
---

> **CallId** = [`Brand`](/reference/protocol/type-aliases/brand/)\<`string`, `"CallId"`\>

Defined in: packages/protocol/src/lib/agent-ids.ts:47

Identifies one call the agent loop makes and expects an answer to, such as
a question for the user or an approval request. Deliberately distinct from
[ToolCallId](/reference/protocol/type-aliases/toolcallid/): a realtime provider's tool call ids and agent loop call
ids are separate id spaces that can meet in one session.
