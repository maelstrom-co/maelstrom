---
editUrl: false
next: false
prev: false
title: "AgentInputMessage"
---

> **AgentInputMessage**: (`args`) => [`AgentInputMessage`](/reference/protocol/interfaces/agentinputmessage/)

Defined in: packages/protocol/src/lib/envelope.ts:139

Smart constructor for [AgentInputMessage](/reference/protocol/variables/agentinputmessage/). Generates a fresh `id` via
`MessageId()` when omitted.

## Parameters

### args

#### id?

[`MessageId`](/reference/protocol/type-aliases/messageid/)

Frame id; generated when omitted.

#### input

[`AgentInput`](/reference/protocol/type-aliases/agentinput/)

The agent input to carry.

#### sessionId

[`SessionId`](/reference/protocol/type-aliases/sessionid/)

Session whose Agent Session receives the input.

## Returns

[`AgentInputMessage`](/reference/protocol/interfaces/agentinputmessage/)

## Example

```ts
ws.send(encodeEnvelope(AgentInputMessage({ sessionId, input: utterance })));
```
