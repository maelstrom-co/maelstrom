---
editUrl: false
next: false
prev: false
title: "CaptureOptions"
---

Defined in: packages/devtools/src/capture.ts:11

Bounds and application-specific projections for explicit content capture.

## Properties

### maxCharacters?

> `readonly` `optional` **maxCharacters?**: `number`

Defined in: packages/devtools/src/capture.ts:15

Maximum serialized event characters. Defaults to 2000000.

***

### maxEvents?

> `readonly` `optional` **maxEvents?**: `number`

Defined in: packages/devtools/src/capture.ts:13

Maximum retained events. Defaults to 1000.

***

### maxStringCharacters?

> `readonly` `optional` **maxStringCharacters?**: `number`

Defined in: packages/devtools/src/capture.ts:17

Maximum characters in one string. Defaults to 16384.

***

### metadata?

> `readonly` `optional` **metadata?**: (`mode`) => `Record`\<`string`, `unknown`\>

Defined in: packages/devtools/src/capture.ts:21

Application-owned model/configuration provenance.

#### Parameters

##### mode

`string`

#### Returns

`Record`\<`string`, `unknown`\>

***

### redact?

> `readonly` `optional` **redact?**: (`value`) => `unknown`

Defined in: packages/devtools/src/capture.ts:19

Additional application redaction, applied before retention and export.

#### Parameters

##### value

`unknown`

#### Returns

`unknown`
