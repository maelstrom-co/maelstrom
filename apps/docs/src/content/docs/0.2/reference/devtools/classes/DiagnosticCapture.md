---
editUrl: false
next: false
prev: false
title: "DiagnosticCapture"
---

Defined in: packages/devtools/src/capture.ts:37

Bounded explicit capture. No content is retained before start.

## Constructors

### Constructor

> **new DiagnosticCapture**(`getKey?`, `options?`): `DiagnosticCapture`

Defined in: packages/devtools/src/capture.ts:67

Creates an inactive capture with optional redaction and bounds.

#### Parameters

##### getKey?

() => `string` \| `null`

##### options?

[`CaptureOptions`](/reference/devtools/interfaces/captureoptions/) = `{}`

#### Returns

`DiagnosticCapture`

## Methods

### addRedactor()

> **addRedactor**(`redact`): () => `void`

Defined in: packages/devtools/src/capture.ts:151

Composes an application policy into an existing store, including retained evidence. Policies should be idempotent.

#### Parameters

##### redact

(`value`) => `unknown`

#### Returns

() => `void`

***

### clear()

> **clear**(): `void`

Defined in: packages/devtools/src/capture.ts:126

Clears retained evidence and notes.

#### Returns

`void`

***

### engineRequest()

> **engineRequest**(`message`): `void`

Defined in: packages/devtools/src/capture.ts:301

Records request identity and update reasons.

#### Parameters

##### message

`ChartRequestMessage`

#### Returns

`void`

***

### engineResponse()

> **engineResponse**(`requestId`, `response`, `durationMs`): `void`

Defined in: packages/devtools/src/capture.ts:310

Records a correlated Engine response.

#### Parameters

##### requestId

`string`

##### response

`MaelstromResponse`

##### durationMs

`number`

#### Returns

`void`

***

### export()

> **export**(`outcome?`): `string`

Defined in: packages/devtools/src/capture.ts:334

Serializes retained evidence using capture schema version 1.

#### Parameters

##### outcome?

`string` = `...`

#### Returns

`string`

***

### getEvidenceRevision()

> **getEvidenceRevision**(): `number`

Defined in: packages/devtools/src/capture.ts:60

Returns a revision for capture evidence changes, including redaction. Note edits update status separately.

#### Returns

`number`

***

### getLimits()

> **getLimits**(): `Required`\<`Pick`\<[`CaptureOptions`](/reference/devtools/interfaces/captureoptions/), `"maxEvents"` \| `"maxCharacters"` \| `"maxStringCharacters"`\>\>

Defined in: packages/devtools/src/capture.ts:76

Returns the configured event, serialized-character, and string limits.

#### Returns

`Required`\<`Pick`\<[`CaptureOptions`](/reference/devtools/interfaces/captureoptions/), `"maxEvents"` \| `"maxCharacters"` \| `"maxStringCharacters"`\>\>

***

### getSnapshot()

> **getSnapshot**(): `object`

Defined in: packages/devtools/src/capture.ts:58

Returns retained capture status.

#### Returns

`object`

##### active

> **active**: `boolean`

##### count

> **count**: `number`

##### dropped

> **dropped**: `number`

##### mode?

> `optional` **mode?**: `string`

##### outcome

> **outcome**: `string`

***

### observations()

> **observations**(`snapshot`, `identity`, `initial?`): `void`

Defined in: packages/devtools/src/capture.ts:259

Records observation changes and post-start transcript revisions.

#### Parameters

##### snapshot

`VoiceObservationSnapshot`

##### identity

`Fields`

##### initial?

`boolean` = `false`

#### Returns

`void`

***

### record()

> **record**(`kind`, `fields`): `void`

Defined in: packages/devtools/src/capture.ts:188

Records one event only during an explicit capture.

#### Parameters

##### kind

`string`

##### fields

`Fields`

#### Returns

`void`

***

### sessionEvent()

> **sessionEvent**(`input`, `identity`): `void`

Defined in: packages/devtools/src/capture.ts:225

Projects supported voice events without retaining raw provider frames.

#### Parameters

##### input

`unknown`

##### identity

`Fields`

#### Returns

`void`

***

### setOutcome()

> **setOutcome**(`outcome`): `void`

Defined in: packages/devtools/src/capture.ts:324

Retains a redacted note, limited to 4000 characters.

#### Parameters

##### outcome

`string`

#### Returns

`void`

***

### start()

> **start**(`mode`, `sessionId?`, `providerInstanceId?`): `void`

Defined in: packages/devtools/src/capture.ts:97

Starts a new capture and clears earlier evidence. Omit identities to capture all Provider lifetimes.

#### Parameters

##### mode

`string`

##### sessionId?

`string`

##### providerInstanceId?

`string`

#### Returns

`void`

***

### stop()

> **stop**(): `void`

Defined in: packages/devtools/src/capture.ts:117

Stops recording and retains the evidence.

#### Returns

`void`

***

### subscribe()

> **subscribe**(`listener`): () => `boolean`

Defined in: packages/devtools/src/capture.ts:62

Observes changes until unsubscribed.

#### Parameters

##### listener

() => `void`

#### Returns

() => `boolean`
