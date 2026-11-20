---
editUrl: false
next: false
prev: false
title: "AgentInputMessage"
---

Defined in: packages/protocol/src/lib/envelope.ts:139

A `client.agent.input` frame: carries one [AgentInput](/reference/protocol/type-aliases/agentinput/) from a client
to the Agent Session of `sessionId`. The inner input keeps its own `type`
discriminator, which cannot collide with transport frame types.

## Properties

### id

> **id**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/envelope.ts:146

Identifies this frame on the transport. Agent correlation uses the inner
`inputId` and `changeId` fields.

***

### input

> **input**: [`AgentInput`](/reference/protocol/type-aliases/agentinput/)

Defined in: packages/protocol/src/lib/envelope.ts:150

The agent input carried by this frame.

***

### sessionId

> **sessionId**: [`SessionId`](/reference/protocol/type-aliases/sessionid/)

Defined in: packages/protocol/src/lib/envelope.ts:148

Session whose Agent Session receives the input.

***

### type

> **type**: `"client.agent.input"`

Defined in: packages/protocol/src/lib/envelope.ts:141

Frame discriminator.
