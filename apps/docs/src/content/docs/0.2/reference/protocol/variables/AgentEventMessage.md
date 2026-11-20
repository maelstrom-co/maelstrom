---
editUrl: false
next: false
prev: false
title: "AgentEventMessage"
---

> **AgentEventMessage**: (`args`) => [`AgentEventMessage`](/reference/protocol/interfaces/agenteventmessage/)

Defined in: packages/protocol/src/lib/envelope.ts:411

Smart constructor for [AgentEventMessage](/reference/protocol/variables/agenteventmessage/). Generates a fresh `id` via
`MessageId()` when omitted.

## Parameters

### args

#### event

[`AgentEvent`](/reference/protocol/type-aliases/agentevent/)

The agent event to carry.

#### id?

[`MessageId`](/reference/protocol/type-aliases/messageid/)

Frame id; generated when omitted.

#### sessionId

[`SessionId`](/reference/protocol/type-aliases/sessionid/)

Session whose Agent Session emitted the event.

## Returns

[`AgentEventMessage`](/reference/protocol/interfaces/agenteventmessage/)

## Example

```ts
ws.send(encodeEnvelope(AgentEventMessage({ sessionId, event: finished })));
```
