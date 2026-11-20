---
editUrl: false
next: false
prev: false
title: "AgentMessageEvent"
---

Defined in: packages/protocol/src/lib/agent-wire.ts:260

A streamed fragment of the loop model's text.

## Properties

### delta

> **delta**: `string`

Defined in: packages/protocol/src/lib/agent-wire.ts:270

Next fragment of text.

***

### runId

> **runId**: [`RunId`](/reference/protocol/type-aliases/runid/)

Defined in: packages/protocol/src/lib/agent-wire.ts:266

The Agent Run producing the text.

***

### turnId

> **turnId**: `string`

Defined in: packages/protocol/src/lib/agent-wire.ts:268

The model turn this fragment belongs to.

***

### type

> **type**: `"message"`

Defined in: packages/protocol/src/lib/agent-wire.ts:262

Member discriminator.

***

### version

> **version**: `1`

Defined in: packages/protocol/src/lib/agent-wire.ts:264

Agent wire version, always [AGENT\_WIRE\_VERSION](/reference/protocol/variables/agent_wire_version/).
