---
editUrl: false
next: false
prev: false
title: "AssistantMessage"
---

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:498

Message to inject into assistant conversation history.
The session ID is not required here — the connector supplies it from the
session established during connect().

## Properties

### id

> `readonly` **id**: [`MessageId`](/reference/client/type-aliases/messageid/)

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:500

Unique message identifier. Used for deduplication and history correlation.

***

### message

> `readonly` **message**: `string`

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:502

Message content
