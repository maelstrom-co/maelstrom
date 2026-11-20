---
editUrl: false
next: false
prev: false
title: "CloseCodeClassification"
---

Defined in: packages/connectors/src/close-code.ts:19

How a client should treat a disconnect reported with a given close code.

## Properties

### clean

> `readonly` **clean**: `boolean`

Defined in: packages/connectors/src/close-code.ts:24

True when the code reports an intentional, orderly close (RFC 6455 1000)
— no auto-reconnect should fire.

***

### retryable

> `readonly` **retryable**: `boolean`

Defined in: packages/connectors/src/close-code.ts:31

False only when retrying cannot fix the rejection (RFC 6455 1008,
"Policy Violation": the server is deliberately refusing this client).
Every other code is retryable, although a clean 1000 close independently
suppresses the client's auto-reconnect behavior.
