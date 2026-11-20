---
editUrl: false
next: false
prev: false
title: "DiagnosticChannel"
---

Defined in: packages/client/src/lib/diagnostic-channel.ts:35

Per-client observation seam shared by optional library integrations.

## Constructors

### Constructor

> **new DiagnosticChannel**(`sessionId`): `DiagnosticChannel`

Defined in: packages/client/src/lib/diagnostic-channel.ts:46

Creates an isolated stream for one application session.

#### Parameters

##### sessionId

[`SessionId`](/reference/client/type-aliases/sessionid/)

#### Returns

`DiagnosticChannel`

## Accessors

### diagnosticsObserved

#### Get Signature

> **get** **diagnosticsObserved**(): `boolean`

Defined in: packages/client/src/lib/diagnostic-channel.ts:59

Whether a consumer holds full diagnostics, including optional remote and capture sources.

##### Returns

`boolean`

***

### locallyObserved

#### Get Signature

> **get** **locallyObserved**(): `boolean`

Defined in: packages/client/src/lib/diagnostic-channel.ts:54

Whether local producer work has a metadata or full diagnostic consumer.

##### Returns

`boolean`

***

### observed

#### Get Signature

> **get** **observed**(): `boolean`

Defined in: packages/client/src/lib/diagnostic-channel.ts:49

Whether a full diagnostic consumer is attached.

:::caution[Deprecated]
Use diagnosticsObserved.
:::

##### Returns

`boolean`

## Methods

### addDiagnosticSource()

> **addDiagnosticSource**(`start`): () => `void`

Defined in: packages/client/src/lib/diagnostic-channel.ts:109

Registers remote or content observation work available only to full diagnostic consumers.

#### Parameters

##### start

() => () => `void`

#### Returns

() => `void`

***

### addLocalSource()

> **addLocalSource**(`start`): () => `void`

Defined in: packages/client/src/lib/diagnostic-channel.ts:104

Registers local metadata producer work, started for metadata or full diagnostic consumers.

#### Parameters

##### start

() => () => `void`

#### Returns

() => `void`

***

### ~~addSource()~~

> **addSource**(`start`): () => `void`

Defined in: packages/client/src/lib/diagnostic-channel.ts:99

Registers full diagnostic observation work.

:::caution[Deprecated]
Use addDiagnosticSource.
:::

#### Parameters

##### start

() => () => `void`

#### Returns

() => `void`

***

### dispose()

> **dispose**(): `void`

Defined in: packages/client/src/lib/diagnostic-channel.ts:183

Releases observers and optional sources.

#### Returns

`void`

***

### emit()

> **emit**\<`Kind`\>(`kind`, ...`args`): `void`

Defined in: packages/client/src/lib/diagnostic-channel.ts:128

Emits an isolated observation. Observer failures never change application behavior.

#### Type Parameters

##### Kind

`Kind` *extends* `string`

#### Parameters

##### kind

`Kind`

##### args

...\[`...ObservationArguments<NoInfer<Kind>>[]`, () => `unknown`, `string`\]

#### Returns

`void`

***

### emitDiagnostic()

> **emitDiagnostic**(`kind`, `metadata?`, `readContent?`, `requestId?`): `void`

Defined in: packages/client/src/lib/diagnostic-channel.ts:152

Emits diagnostic-only evidence without notifying operational metadata observers.

#### Parameters

##### kind

`string`

##### metadata?

`DiagnosticMetadata` = `{}`

##### readContent?

() => `unknown`

##### requestId?

`string`

#### Returns

`void`

***

### observeControls()

> **observeControls**(`listener`): () => `void`

Defined in: packages/client/src/lib/diagnostic-channel.ts:75

Replays current controls and observes changes without keeping collection sources alive.

#### Parameters

##### listener

(`event`) => `void`

#### Returns

() => `void`

***

### subscribe()

> **subscribe**(`listener`): () => `void`

Defined in: packages/client/src/lib/diagnostic-channel.ts:86

Observes events; unsubscribe releases optional sources after the last observer.

#### Parameters

##### listener

(`observation`) => `void`

#### Returns

() => `void`

***

### subscribeMetadata()

> **subscribeMetadata**(`listener`): () => `void`

Defined in: packages/client/src/lib/diagnostic-channel.ts:64

Observes local producer metadata; forwarded and diagnostic-only evidence is excluded.

#### Parameters

##### listener

`TelemetryMetadataObserver`

#### Returns

() => `void`
