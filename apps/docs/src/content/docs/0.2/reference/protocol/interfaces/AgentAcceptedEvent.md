---
editUrl: false
next: false
prev: false
title: "AgentAcceptedEvent"
---

Defined in: packages/protocol/src/lib/agent-wire.ts:229

The Engine's decision about an input.

## Properties

### ack

> **ack**: `string`

Defined in: packages/protocol/src/lib/agent-wire.ts:244

Short acknowledgement text.

***

### disposition

> **disposition**: `"ui_only"` \| `"agent"` \| `"amend"` \| `"independent"` \| `"answer"` \| `"supersede"` \| `"noise"`

Defined in: packages/protocol/src/lib/agent-wire.ts:242

How the input is handled.

***

### inputId

> **inputId**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/agent-wire.ts:235

The input that was accepted.

***

### runId

> **runId**: [`RunId`](/reference/protocol/type-aliases/runid/) \| `null`

Defined in: packages/protocol/src/lib/agent-wire.ts:240

The Agent Run that handles the input, or `null` when the disposition
starts no run (`noise`).

***

### type

> **type**: `"accepted"`

Defined in: packages/protocol/src/lib/agent-wire.ts:231

Member discriminator.

***

### version

> **version**: `1`

Defined in: packages/protocol/src/lib/agent-wire.ts:233

Agent wire version, always [AGENT\_WIRE\_VERSION](/reference/protocol/variables/agent_wire_version/).
