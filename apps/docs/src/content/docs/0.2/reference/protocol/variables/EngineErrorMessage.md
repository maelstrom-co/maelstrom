---
editUrl: false
next: false
prev: false
title: "EngineErrorMessage"
---

> **EngineErrorMessage**: (`args`) => [`EngineErrorMessage`](/reference/protocol/interfaces/engineerrormessage/)

Defined in: packages/protocol/src/lib/envelope.ts:355

Smart constructor for [EngineErrorMessage](/reference/protocol/variables/engineerrormessage/). Omits each optional field
(`requestId`, `sessionId`, `code`) when not supplied so absent optionals do
not survive as explicit `undefined` across encode/decode.

## Parameters

### args

#### code?

`string`

#### error

`string`

#### requestId?

[`MessageId`](/reference/protocol/type-aliases/messageid/)

#### sessionId?

[`SessionId`](/reference/protocol/type-aliases/sessionid/)

## Returns

[`EngineErrorMessage`](/reference/protocol/interfaces/engineerrormessage/)
