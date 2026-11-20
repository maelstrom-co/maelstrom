---
editUrl: false
next: false
prev: false
title: "AcknowledgedAssistantMessage"
---

> **AcknowledgedAssistantMessage**: (`args`) => [`AcknowledgedAssistantMessage`](/reference/protocol/interfaces/acknowledgedassistantmessage/)

Defined in: packages/protocol/src/lib/envelope.ts:81

Constructs an acknowledged assistant-history injection.

Defaults `id` and `timestamp` exactly like [AssistantInjectionMessage](/reference/protocol/variables/assistantinjectionmessage/),
then validates the complete wire value. Empty or whitespace-only ids and
session ids, empty content, and non-finite timestamps throw synchronously.
The host echoes the generated or supplied id in either the result or a
correlated error. Unlike the legacy constructor, this discriminator opts in
to that response.

## Parameters

### args

#### content

`string`

Non-empty assistant text persisted without invoking the LLM.

#### id?

[`MessageId`](/reference/protocol/type-aliases/messageid/)

Correlation and deduplication id; generated when omitted.

#### sessionId

[`SessionId`](/reference/protocol/type-aliases/sessionid/)

Session whose history receives the assistant entry.

#### timestamp?

`number`

Finite event time in milliseconds; defaults to `Date.now()`.

## Returns

[`AcknowledgedAssistantMessage`](/reference/protocol/interfaces/acknowledgedassistantmessage/)
