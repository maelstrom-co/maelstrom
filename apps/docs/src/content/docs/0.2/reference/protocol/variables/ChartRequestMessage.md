---
editUrl: false
next: false
prev: false
title: "ChartRequestMessage"
---

> **ChartRequestMessage**: (`args`) => [`ChartRequestMessage`](/reference/protocol/interfaces/chartrequestmessage/)

Defined in: packages/protocol/src/lib/engine-message.ts:47

Smart constructor for [ChartRequestMessage](/reference/protocol/variables/chartrequestmessage/). Fills in `id` and
`timestamp` with sensible defaults when omitted so callers only have to
supply the session + payload in the common case.

## Parameters

### args

#### id?

[`MessageId`](/reference/protocol/type-aliases/messageid/)

#### request

[`ChartRequest`](/reference/protocol/interfaces/chartrequest/)

#### sessionId

[`SessionId`](/reference/protocol/type-aliases/sessionid/)

#### timestamp?

`number`

## Returns

[`ChartRequestMessage`](/reference/protocol/interfaces/chartrequestmessage/)
