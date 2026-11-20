---
editUrl: false
next: false
prev: false
title: "DiagnosticObservation"
---

Defined in: packages/client/src/lib/diagnostic-channel.ts:14

Lazy content stays unevaluated unless an observer explicitly records it.

## Properties

### event

> `readonly` **event**: `DiagnosticEvent`

Defined in: packages/client/src/lib/diagnostic-channel.ts:16

Metadata-only event.

***

### readContent?

> `readonly` `optional` **readContent?**: () => `unknown`

Defined in: packages/client/src/lib/diagnostic-channel.ts:18

Returns content only when called by an explicit capture.

#### Returns

`unknown`
