---
editUrl: false
next: false
prev: false
title: "AgentUiChangeEvent"
---

Defined in: packages/protocol/src/lib/agent-wire.ts:286

A UI change for the browser to apply.

## Properties

### changeId

> **changeId**: [`ChangeId`](/reference/protocol/type-aliases/changeid/)

Defined in: packages/protocol/src/lib/agent-wire.ts:294

Id the browser echoes when it acknowledges the change.

***

### response

> **response**: [`MaelstromResponse`](/reference/protocol/interfaces/maelstromresponse/)

Defined in: packages/protocol/src/lib/agent-wire.ts:299

The [MaelstromResponse](/reference/protocol/interfaces/maelstromresponse/) to apply: layout first, then the Execution
Plan.

***

### runId

> **runId**: [`RunId`](/reference/protocol/type-aliases/runid/) \| `null`

Defined in: packages/protocol/src/lib/agent-wire.ts:292

The Agent Run that caused the change, or `null` outside any run.

***

### type

> **type**: `"ui_change"`

Defined in: packages/protocol/src/lib/agent-wire.ts:288

Member discriminator.

***

### version

> **version**: `1`

Defined in: packages/protocol/src/lib/agent-wire.ts:290

Agent wire version, always [AGENT\_WIRE\_VERSION](/reference/protocol/variables/agent_wire_version/).
