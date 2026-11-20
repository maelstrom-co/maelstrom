---
editUrl: false
next: false
prev: false
title: "Devtools"
---

Defined in: packages/devtools/src/types.ts:68

Framework-independent collector and capture interface.

## Properties

### capture

> `readonly` **capture**: [`DiagnosticCapture`](/reference/devtools/classes/diagnosticcapture/)

Defined in: packages/devtools/src/types.ts:72

Explicit bounded content capture.

***

### options

> `readonly` **options**: [`DevtoolsOptions`](/reference/devtools/interfaces/devtoolsoptions/)

Defined in: packages/devtools/src/types.ts:70

Configuration used by the shared panel.

## Methods

### attach()

> **attach**(`orchestrator`): () => `void`

Defined in: packages/devtools/src/types.ts:82

Attaches before connect; cleanup retains bounded history after detachment.

#### Parameters

##### orchestrator

`Orchestrator`

#### Returns

() => `void`

***

### clear()

> **clear**(): `void`

Defined in: packages/devtools/src/types.ts:78

Clears capture, imported evidence, activity, and detached lifetimes. Active clients remain attached.

#### Returns

`void`

***

### closeImport()

> **closeImport**(): `void`

Defined in: packages/devtools/src/types.ts:92

Removes imported evidence from the panel.

#### Returns

`void`

***

### dispose()

> **dispose**(): `void`

Defined in: packages/devtools/src/types.ts:98

Releases subscriptions and evidence.

#### Returns

`void`

***

### exportCapture()

> **exportCapture**(): `string`

Defined in: packages/devtools/src/types.ts:88

Exports a versioned JSON capture without executing any work.

#### Returns

`string`

***

### getSnapshot()

> **getSnapshot**(): [`DevtoolsSnapshot`](/reference/devtools/interfaces/devtoolssnapshot/)

Defined in: packages/devtools/src/types.ts:74

Returns a stable snapshot until the store changes.

#### Returns

[`DevtoolsSnapshot`](/reference/devtools/interfaces/devtoolssnapshot/)

***

### importCapture()

> **importCapture**(`json`): `void`

Defined in: packages/devtools/src/types.ts:90

Validates and opens a bounded capture for read-only inspection. Throws on invalid files.

#### Parameters

##### json

`string`

#### Returns

`void`

***

### inspect()

> **inspect**(`clientId`): `unknown`

Defined in: packages/devtools/src/types.ts:76

Reads full live definitions only on explicit inspection; retained clients expose structural evidence.

#### Parameters

##### clientId

`string`

#### Returns

`unknown`

***

### setHighlightedInstance()?

> `optional` **setHighlightedInstance**(`clientId?`, `instanceId?`): `void`

Defined in: packages/devtools/src/types.ts:96

Highlights a rendered Instance on its owning active client without changing layout. Omit either identity to clear selection.

#### Parameters

##### clientId?

`string`

##### instanceId?

`string`

#### Returns

`void`

***

### setOverlays()

> **setOverlays**(`enabled`): `void`

Defined in: packages/devtools/src/types.ts:94

Enables visual Chart outlines without changing its layout.

#### Parameters

##### enabled

`boolean`

#### Returns

`void`

***

### startCapture()

> **startCapture**(`clientId?`): `void`

Defined in: packages/devtools/src/types.ts:84

Starts content capture for all Providers, or one active lifetime. A stale lifetime throws without clearing evidence.

#### Parameters

##### clientId?

`string`

#### Returns

`void`

***

### stopCapture()

> **stopCapture**(): `void`

Defined in: packages/devtools/src/types.ts:86

Stops content capture and unsubscribes server content forwarding.

#### Returns

`void`

***

### subscribe()

> **subscribe**(`listener`): () => `void`

Defined in: packages/devtools/src/types.ts:80

Observes state until unsubscribed.

#### Parameters

##### listener

() => `void`

#### Returns

() => `void`
