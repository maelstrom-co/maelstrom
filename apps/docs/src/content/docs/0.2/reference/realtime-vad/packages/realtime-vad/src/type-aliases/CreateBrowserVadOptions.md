---
editUrl: false
next: false
prev: false
title: "CreateBrowserVadOptions"
---

> **CreateBrowserVadOptions** = `object`

Defined in: packages/realtime-vad/src/browser-vad.ts:29

The parameter type of [createBrowserVad](/reference/realtime-vad/packages/realtime-vad/src/functions/createbrowservad/).

The three turn callbacks are the whole integration surface: this package
detects speech edges and never touches the transport, so resuming
publication, flushing pre-roll, and discarding a misfire are all the
caller's work. `cancelTurn` is required, not optional — every sub-threshold
utterance invokes it, and a missing implementation retires the VAD and drops
the session to manual turns permanently.

## Properties

### cancelTurn

> `readonly` **cancelTurn**: () => `Promise`\<`void`\>

Defined in: packages/realtime-vad/src/browser-vad.ts:39

Cancels a misfire without the provider commit performed by `endTurn`.

#### Returns

`Promise`\<`void`\>

***

### config

> `readonly` **config**: `Omit`\<`EnabledBrowserVadConfig`, `"enabled"`\>

Defined in: packages/realtime-vad/src/browser-vad.ts:33

Already validated automatic-mode configuration.

***

### endTurn

> `readonly` **endTurn**: () => `Promise`\<`void`\>

Defined in: packages/realtime-vad/src/browser-vad.ts:37

Drains and closes the matching adapter generation's active turn.

#### Returns

`Promise`\<`void`\>

***

### loadMicVAD?

> `readonly` `optional` **loadMicVAD?**: () => `Promise`\<`MicVADFactory`\>

Defined in: packages/realtime-vad/src/browser-vad.ts:51

Test seam; production dynamically imports MicVAD.

#### Returns

`Promise`\<`MicVADFactory`\>

***

### onFailure

> `readonly` **onFailure**: (`error`, `context`) => `Promise`\<`void`\>

Defined in: packages/realtime-vad/src/browser-vad.ts:41

Converts an automatic callback failure into safe manual degradation.

#### Parameters

##### error

`unknown`

##### context

###### retire

() => `Promise`\<`void`\>

Idempotently pauses and destroys this VAD generation.

###### turnActive

`boolean`

Whether transport turn closure still belongs to the adapter.

#### Returns

`Promise`\<`void`\>

***

### startTurn

> `readonly` **startTurn**: () => `Promise`\<`void`\>

Defined in: packages/realtime-vad/src/browser-vad.ts:35

Starts the matching adapter generation with configured transport pre-roll.

#### Returns

`Promise`\<`void`\>

***

### stream

> `readonly` **stream**: `MediaStream`

Defined in: packages/realtime-vad/src/browser-vad.ts:31

Connection-bound local clone; MicVAD may observe but never stop it.
