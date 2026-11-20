---
editUrl: false
next: false
prev: false
title: "AgentPlaceholderEvent"
---

Defined in: packages/protocol/src/lib/agent-wire.ts:196

Immediate feedback for an input.

## Properties

### inputId

> **inputId**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/agent-wire.ts:202

The input this placeholder answers.

***

### text

> **text**: `string`

Defined in: packages/protocol/src/lib/agent-wire.ts:204

Text to show while the input is being handled.

***

### type

> **type**: `"placeholder"`

Defined in: packages/protocol/src/lib/agent-wire.ts:198

Member discriminator.

***

### version

> **version**: `1`

Defined in: packages/protocol/src/lib/agent-wire.ts:200

Agent wire version, always [AGENT\_WIRE\_VERSION](/reference/protocol/variables/agent_wire_version/).
