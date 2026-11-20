---
editUrl: false
next: false
prev: false
title: "AdapterDiagnosticObservation"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:279

Projected provider facts, separate from raw native envelopes and voice media.

## Properties

### kind

> `readonly` **kind**: `string`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:281

Provider-local category; consumers place it beneath a reserved voice namespace.

***

### metadata

> `readonly` **metadata**: `DiagnosticMetadata`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:285

Scalar facts without prompts, arguments, instructions, credentials, or audio.

***

### providerGeneration

> `readonly` **providerGeneration**: `number`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:283

Native provider generation, independent of the session's generation.

***

### readContent?

> `readonly` `optional` **readContent?**: () => `unknown`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:289

Allowlisted application content, evaluated only by explicit recording.

#### Returns

`unknown`

***

### response?

> `readonly` `optional` **response?**: [`AdapterDiagnosticResponse`](/reference/realtime/type-aliases/adapterdiagnosticresponse/)

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:287

Optional normalized response evidence; native metadata alone does not establish its lifecycle.
