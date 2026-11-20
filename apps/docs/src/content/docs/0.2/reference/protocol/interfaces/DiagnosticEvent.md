---
editUrl: false
next: false
prev: false
title: "DiagnosticEvent"
---

Defined in: packages/protocol/src/lib/diagnostics.ts:12

One diagnostic observation. Durations use the emitting process's clock.

## Properties

### at

> `readonly` **at**: `number`

Defined in: packages/protocol/src/lib/diagnostics.ts:18

Wall-clock emission time; clocks in different processes can disagree.

***

### content?

> `readonly` `optional` **content?**: `unknown`

Defined in: packages/protocol/src/lib/diagnostics.ts:28

Explicitly recorded application content, after producer-side redaction.

***

### id

> `readonly` **id**: `string`

Defined in: packages/protocol/src/lib/diagnostics.ts:14

Unique event identity within a capture.

***

### kind

> `readonly` **kind**: `string`

Defined in: packages/protocol/src/lib/diagnostics.ts:16

Namespaced event name, such as `client.request.started`.

***

### metadata

> `readonly` **metadata**: [`DiagnosticMetadata`](/reference/protocol/type-aliases/diagnosticmetadata/)

Defined in: packages/protocol/src/lib/diagnostics.ts:26

Metadata that excludes transcripts, prompts, arguments, and credentials.

***

### requestId?

> `readonly` `optional` **requestId?**: `string`

Defined in: packages/protocol/src/lib/diagnostics.ts:22

Originating request when the producer can prove the association.

***

### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: packages/protocol/src/lib/diagnostics.ts:24

Server-minted Agent Run whose work produced this event.

***

### sessionId

> `readonly` **sessionId**: `string`

Defined in: packages/protocol/src/lib/diagnostics.ts:20

Session whose work produced this event.
