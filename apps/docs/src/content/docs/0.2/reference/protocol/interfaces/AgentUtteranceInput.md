---
editUrl: false
next: false
prev: false
title: "AgentUtteranceInput"
---

Defined in: packages/protocol/src/lib/agent-wire.ts:127

A user utterance sent to the agent.

## Properties

### chart

> **chart**: [`ChartRequest`](/reference/protocol/interfaces/chartrequest/)

Defined in: packages/protocol/src/lib/agent-wire.ts:137

Current Chart state when the user spoke.

***

### inputId

> **inputId**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/agent-wire.ts:133

Client-assigned id for deduplication and correlation.

***

### source

> **source**: `"text"` \| `"voice"`

Defined in: packages/protocol/src/lib/agent-wire.ts:139

Whether the text was typed or transcribed from voice.

***

### text

> **text**: `string`

Defined in: packages/protocol/src/lib/agent-wire.ts:135

What the user said or typed.

***

### type

> **type**: `"utterance"`

Defined in: packages/protocol/src/lib/agent-wire.ts:129

Member discriminator.

***

### version

> **version**: `1`

Defined in: packages/protocol/src/lib/agent-wire.ts:131

Agent wire version, always [AGENT\_WIRE\_VERSION](/reference/protocol/variables/agent_wire_version/).
