---
editUrl: false
next: false
prev: false
title: "decodeClientEnvelope"
---

> **decodeClientEnvelope**(`raw`): [`Result`](/reference/protocol/type-aliases/result/)\<[`ClientEnvelope`](/reference/protocol/type-aliases/clientenvelope/), [`EnvelopeError`](/reference/protocol/classes/envelopeerror/)\>

Defined in: packages/protocol/src/lib/envelope.ts:589

Decodes a client → engine-host frame into a typed [ClientEnvelope](/reference/protocol/type-aliases/clientenvelope/).

Accepts a JSON string, a `Uint8Array`/`Buffer`, or an already-parsed object.
Owns the two failure modes: a malformed JSON string yields an
`invalid_json` [EnvelopeError](/reference/protocol/classes/envelopeerror/); an unknown `type` or any schema
violation yields an `invalid_envelope` one whose message names the offending
discriminator and the first issue. Returns a [Result](/reference/protocol/type-aliases/result/) — it never
throws — so a host message loop can branch without a try/catch.

## Parameters

### raw

`unknown`

## Returns

[`Result`](/reference/protocol/type-aliases/result/)\<[`ClientEnvelope`](/reference/protocol/type-aliases/clientenvelope/), [`EnvelopeError`](/reference/protocol/classes/envelopeerror/)\>

## Example

```ts
// engine-host message handler
const decoded = decodeClientEnvelope(rawFrame);
if (isErr(decoded)) { ws.send(encodeEnvelope(EngineErrorMessage({ error: decoded.error.message }))); return; }
switch (decoded.value.type) {
  case 'chart_request': ...; break;
  case 'client.history.get': ...; break;
}
```
