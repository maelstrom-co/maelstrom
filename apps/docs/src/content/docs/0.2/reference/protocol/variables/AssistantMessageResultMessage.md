---
editUrl: false
next: false
prev: false
title: "AssistantMessageResultMessage"
---

> **AssistantMessageResultMessage**: (`args`) => [`AssistantMessageResultMessage`](/reference/protocol/interfaces/assistantmessageresultmessage/)

Defined in: packages/protocol/src/lib/envelope.ts:300

Smart constructor for [AssistantMessageResultMessage](/reference/protocol/variables/assistantmessageresultmessage/).

`requestId` must be the acknowledged injection message id.
`outcome` is `'inserted'` when history grew and `'deduped'` when the engine
already held that id.

## Parameters

### args

#### outcome

`"inserted"` \| `"deduped"`

Engine-reported insertion or deduplication result.

#### requestId

[`MessageId`](/reference/protocol/type-aliases/messageid/)

Id of the acknowledged request being answered.

#### sessionId

[`SessionId`](/reference/protocol/type-aliases/sessionid/)

Session whose history was targeted.

## Returns

[`AssistantMessageResultMessage`](/reference/protocol/interfaces/assistantmessageresultmessage/)
