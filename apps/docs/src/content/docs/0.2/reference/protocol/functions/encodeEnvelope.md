---
editUrl: false
next: false
prev: false
title: "encodeEnvelope"
---

> **encodeEnvelope**(`env`): `string`

Defined in: packages/protocol/src/lib/envelope.ts:511

Serializes any envelope to the wire string. The inverse of the `decode*`
functions; a plain JSON encode, isolated here so the contract has one
encode/decode pair callers can reach for.

## Parameters

### env

[`ClientEnvelope`](/reference/protocol/type-aliases/clientenvelope/) \| [`ServerEnvelope`](/reference/protocol/type-aliases/serverenvelope/)

## Returns

`string`

## Example

```ts
// connector side (client → engine host)
ws.send(encodeEnvelope(ChartRequestMessage({ sessionId, request })));
// host side (engine host → client)
ws.send(encodeEnvelope(EngineErrorMessage({ error: 'boom', requestId })));
```
