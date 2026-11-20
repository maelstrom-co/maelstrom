---
editUrl: false
next: false
prev: false
title: "MaelstromState"
---

Defined in: packages/react/src/lib/maelstrom-state-types.ts:10

Return type of m.useMaelstrom()

## Properties

### connectionError

> **connectionError**: `Error` \| `null`

Defined in: packages/react/src/lib/maelstrom-state-types.ts:29

Last connection error, if connectionStatus is 'error'

***

### connectionStatus

> **connectionStatus**: `ConnectionStatus`

Defined in: packages/react/src/lib/maelstrom-state-types.ts:27

Current connection status

***

### enqueueIntent

> **enqueueIntent**: (`intent`, `options?`) => `IntentSubmission`

Defined in: packages/react/src/lib/maelstrom-state-types.ts:20

Admit immediately to the client-owned FIFO, including while busy. Operational
outcomes resolve on the ticket; they do not update lastError/lastResponse.
Observe it with useIntentSubmission. No retry is performed for unknown work.
A foreign options.scope throws synchronously. Unmounting this hook does not
cancel accepted work; use a client IntentScope for owner-lifetime retirement.

#### Parameters

##### intent

`string`

##### options?

`EnqueueIntentOptions`

#### Returns

`IntentSubmission`

***

### intentScheduler

> **intentScheduler**: `IntentSchedulerState`

Defined in: packages/react/src/lib/maelstrom-state-types.ts:25

Shared admission state, including queued voice work and atomic application.

***

### isProcessing

> **isProcessing**: `boolean`

Defined in: packages/react/src/lib/maelstrom-state-types.ts:31

Whether a request is currently in flight

***

### lastError

> **lastError**: `Error` \| `null`

Defined in: packages/react/src/lib/maelstrom-state-types.ts:33

Last error from processIntent — auto-clears on next call

***

### lastResponse

> **lastResponse**: `MaelstromResponse` \| `null`

Defined in: packages/react/src/lib/maelstrom-state-types.ts:35

Last successful engine response — clears when the next call starts

***

### processIntent

> **processIntent**: (`intent`) => `Promise`\<`void`\>

Defined in: packages/react/src/lib/maelstrom-state-types.ts:12

Send a user intent to the engine. Never rejects — errors surface via lastError.

#### Parameters

##### intent

`string`

#### Returns

`Promise`\<`void`\>

***

### sessionId

> **sessionId**: `SessionId`

Defined in: packages/react/src/lib/maelstrom-state-types.ts:37

Current session ID
