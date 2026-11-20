---
editUrl: false
next: false
prev: false
title: "Logger"
---

Defined in: packages/engine/src/lib/logger.ts:2

Logger injected into the Engine; implementations may discard individual levels.

## Methods

### debug()

> **debug**(`message`, `data?`): `void`

Defined in: packages/engine/src/lib/logger.ts:4

Receives potentially high-volume diagnostic events.

#### Parameters

##### message

`string`

##### data?

`Record`\<`string`, `unknown`\>

#### Returns

`void`

***

### error()

> **error**(`message`, `error?`, `data?`): `void`

Defined in: packages/engine/src/lib/logger.ts:10

Records a failure, keeping the error separate from correlation data.

#### Parameters

##### message

`string`

##### error?

`unknown`

##### data?

`Record`\<`string`, `unknown`\>

#### Returns

`void`

***

### info()

> **info**(`message`, `data?`): `void`

Defined in: packages/engine/src/lib/logger.ts:6

Receives normal lifecycle and retry events.

#### Parameters

##### message

`string`

##### data?

`Record`\<`string`, `unknown`\>

#### Returns

`void`

***

### warn()

> **warn**(`message`, `data?`): `void`

Defined in: packages/engine/src/lib/logger.ts:8

Receives recoverable conditions after which processing continues.

#### Parameters

##### message

`string`

##### data?

`Record`\<`string`, `unknown`\>

#### Returns

`void`
