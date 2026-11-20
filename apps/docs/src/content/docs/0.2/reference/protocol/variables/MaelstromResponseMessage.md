---
editUrl: false
next: false
prev: false
title: "MaelstromResponseMessage"
---

> **MaelstromResponseMessage**: (`args`) => [`MaelstromResponseMessage`](/reference/protocol/interfaces/maelstromresponsemessage/)

Defined in: packages/protocol/src/lib/envelope.ts:220

Smart constructor for [MaelstromResponseMessage](/reference/protocol/variables/maelstromresponsemessage/). Omits `sessionId`
from the constructed object when not supplied so an absent optional never
survives as an explicit `undefined` across encode/decode.

## Parameters

### args

#### requestId

[`MessageId`](/reference/protocol/type-aliases/messageid/)

#### response

[`MaelstromResponse`](/reference/protocol/interfaces/maelstromresponse/)

#### sessionId?

[`SessionId`](/reference/protocol/type-aliases/sessionid/)

## Returns

[`MaelstromResponseMessage`](/reference/protocol/interfaces/maelstromresponsemessage/)
