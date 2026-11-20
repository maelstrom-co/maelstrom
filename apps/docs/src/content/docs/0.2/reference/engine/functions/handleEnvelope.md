---
editUrl: false
next: false
prev: false
title: "handleEnvelope"
---

> **handleEnvelope**(`engine`, `raw`): `Promise`\<`ServerEnvelope` \| `null`\>

Defined in: packages/engine/src/lib/envelope-handler.ts:118

The single dispatch entry point every WebSocket engine host shares: decode a
raw client frame, route it to the [Engine](/reference/engine/interfaces/engine/), and map the outcome to the
ServerEnvelope the host should send back (or `null` when the frame
warrants no reply).

Centralizing this keeps every host from re-deriving the decode → dispatch →
error-mapping logic (and drifting on error correlation). The mapping, by
frame type:

- **decode failure** → an `engine.error` carrying the EnvelopeError
  message and its `kind` as `code`. Correlation ids are recovered from the
  raw frame when present so the client's pending request is rejected rather
  than left to time out.
- **`chart_request`** → `engine.handle`; an engine `Err` maps to
  `engine.error` (the import('./errors.js').EngineError `_tag` as
  `code`), an `Ok` `chart_response` to `engine.maelstrom.response`, any other
  `Ok` output to `engine.error` with `code: 'UnexpectedOutput'` (a
  contract violation, not a case that should strand the client silently).
- **`assistant_message`** → `engine.handle`, then always `null`. This legacy
  fire-and-forget arm emits no result or error frame, including when Engine
  returns or throws a history failure.
- **`client.assistant_message.acknowledged`** → the same assistant injection
  semantics through `engine.handle`; an `Ok` `assistant_message_result` maps
  to a correlated `engine.assistant_message.result`. Unexpected output,
  Engine errors, and thrown failures map to a correlated `engine.error`.
- **`client.history.get`** → `engine.getHistory`; `Ok` → `engine.history.response`,
  `Err` → `engine.error`.
- **`client.agent.input`** → a correlated `engine.error` with
  `code: 'UnsupportedInput'`.

Never rejects. A thrown exception (an engine contract violation) is caught
and mapped to an `engine.error` correlated to the in-scope frame, with no
`code`.

## Parameters

### engine

[`Engine`](/reference/engine/interfaces/engine/)

### raw

`unknown`

## Returns

`Promise`\<`ServerEnvelope` \| `null`\>

## Example

```ts
// WebSocket host message loop
ws.on('message', async (raw) => {
  const reply = await handleEnvelope(engine, raw);
  if (reply) ws.send(encodeEnvelope(reply));
});
```
