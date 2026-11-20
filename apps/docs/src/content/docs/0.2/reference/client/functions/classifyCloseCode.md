---
editUrl: false
next: false
prev: false
title: "classifyCloseCode"
---

> **classifyCloseCode**(`code`): [`CloseCodeClassification`](/reference/client/interfaces/closecodeclassification/)

Defined in: packages/connectors/dist/close-code.d.ts:39

Map a WebSocket close code to the reconnect semantics used by the client
connector.

Only 1000 and 1008 carry meaning beyond "the transport went away". Every
other number classifies as unclean but retryable.

## Parameters

### code

`number`

## Returns

[`CloseCodeClassification`](/reference/client/interfaces/closecodeclassification/)
