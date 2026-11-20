---
editUrl: false
next: false
prev: false
title: "AgentEventMessage"
---

Defined in: packages/protocol/src/lib/envelope.ts:411

An `engine.agent.event` frame: carries one [AgentEvent](/reference/protocol/type-aliases/agentevent/) from the Agent
Session of `sessionId` to its client. Events are streamed and correlate to
inputs through the inner event's `inputId` or `changeId`, not to a request,
so the frame carries its own `id` rather than a `requestId`.

## Properties

### event

> **event**: [`AgentEvent`](/reference/protocol/type-aliases/agentevent/)

Defined in: packages/protocol/src/lib/envelope.ts:422

The agent event carried by this frame.

***

### id

> **id**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/envelope.ts:418

Identifies this frame on the transport. Agent correlation uses the inner
`inputId` and `changeId` fields.

***

### sessionId

> **sessionId**: [`SessionId`](/reference/protocol/type-aliases/sessionid/)

Defined in: packages/protocol/src/lib/envelope.ts:420

Session whose Agent Session emitted the event.

***

### type

> **type**: `"engine.agent.event"`

Defined in: packages/protocol/src/lib/envelope.ts:413

Frame discriminator.
