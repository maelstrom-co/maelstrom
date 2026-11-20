---
editUrl: false
next: false
prev: false
title: "AdapterDiagnosticSource"
---

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:293

Optional provider diagnostics. Observers cannot change provider behavior.

## Methods

### subscribe()

> **subscribe**(`observer`): `Unsubscribe`

Defined in: packages/realtime/src/lib/realtime-session/provider-adapter.types.ts:295

Observes subsequent projected facts until released; no raw envelopes are exposed.

#### Parameters

##### observer

(`observation`) => `void`

#### Returns

`Unsubscribe`
