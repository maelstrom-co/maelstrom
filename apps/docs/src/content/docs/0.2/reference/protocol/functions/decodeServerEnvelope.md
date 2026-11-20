---
editUrl: false
next: false
prev: false
title: "decodeServerEnvelope"
---

> **decodeServerEnvelope**(`raw`): [`Result`](/reference/protocol/type-aliases/result/)\<[`ServerEnvelope`](/reference/protocol/type-aliases/serverenvelope/), [`EnvelopeError`](/reference/protocol/classes/envelopeerror/)\>

Defined in: packages/protocol/src/lib/envelope.ts:619

Decodes an engine-host → client frame into a typed [ServerEnvelope](/reference/protocol/type-aliases/serverenvelope/).

Same input handling and failure semantics as [decodeClientEnvelope](/reference/protocol/functions/decodeclientenvelope/),
validated against the [ServerEnvelopeSchema](/reference/protocol/variables/serverenvelopeschema/) direction. Returns a
[Result](/reference/protocol/type-aliases/result/); never throws.

## Parameters

### raw

`unknown`

## Returns

[`Result`](/reference/protocol/type-aliases/result/)\<[`ServerEnvelope`](/reference/protocol/type-aliases/serverenvelope/), [`EnvelopeError`](/reference/protocol/classes/envelopeerror/)\>

## Example

```ts
// connector onmessage handler
const decoded = decodeServerEnvelope(event.data);
if (isErr(decoded)) { console.error(decoded.error.message); return; }
switch (decoded.value.type) {
  case 'engine.maelstrom.response': resolve(decoded.value.requestId, decoded.value.response); break;
  case 'engine.history.response': ...; break;
  case 'engine.error': reject(decoded.value.requestId, decoded.value.error); break;
}
```
