---
editUrl: false
next: false
prev: false
title: "VoiceDiagnostics"
---

Defined in: packages/devtools/src/voice-diagnostics.ts:86

Retains the latest 100 voice metadata events and 16 terminal transport summaries.

## Constructors

### Constructor

> **new VoiceDiagnostics**(): `VoiceDiagnostics`

#### Returns

`VoiceDiagnostics`

## Methods

### getSnapshot()

> **getSnapshot**(): readonly [`DiagnosticEntry`](/reference/devtools/interfaces/diagnosticentry/) & `object`[]

Defined in: packages/devtools/src/voice-diagnostics.ts:94

Returns retained recent metadata.

#### Returns

readonly [`DiagnosticEntry`](/reference/devtools/interfaces/diagnosticentry/) & `object`[]

***

### getTransportHistory()

> **getTransportHistory**(): readonly [`RetainedLiveTransport`](/reference/devtools/interfaces/retainedlivetransport/)[]

Defined in: packages/devtools/src/voice-diagnostics.ts:96

Returns bounded terminal transport history.

#### Returns

readonly [`RetainedLiveTransport`](/reference/devtools/interfaces/retainedlivetransport/)[]

***

### onSessionEvent()

> **onSessionEvent**(`input`, `identity?`): `void`

Defined in: packages/devtools/src/voice-diagnostics.ts:177

Projects lifecycle and tool events; transcript content is excluded.

#### Parameters

##### input

`unknown`

##### identity?

[`VoiceEventIdentity`](/reference/devtools/interfaces/voiceeventidentity/) = `{}`

#### Returns

`void`

***

### record()

> **record**(`entry`): `void`

Defined in: packages/devtools/src/voice-diagnostics.ts:153

Retains a projected metadata event without content.

#### Parameters

##### entry

[`DiagnosticEntry`](/reference/devtools/interfaces/diagnosticentry/)

#### Returns

`void`

***

### retainTransport()

> **retainTransport**\<`T`\>(`snapshot`, `identity`): `void`

Defined in: packages/devtools/src/voice-diagnostics.ts:98

Projects a terminal transport before retaining it.

#### Type Parameters

##### T

`T` *extends* [`TransportSnapshot`](/reference/devtools/interfaces/transportsnapshot/)

#### Parameters

##### snapshot

`T`

##### identity

###### backendModel

`string`

###### model

`string`

###### providerInstanceId

`string`

#### Returns

`void`

***

### subscribe()

> **subscribe**(`listener`): () => `void`

Defined in: packages/devtools/src/voice-diagnostics.ts:146

Observes metadata and history changes.

#### Parameters

##### listener

() => `void`

#### Returns

() => `void`
