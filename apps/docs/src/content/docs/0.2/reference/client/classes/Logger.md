---
editUrl: false
next: false
prev: false
title: "Logger"
---

Defined in: packages/client/src/lib/utils/logger.ts:13

Logger class for Maelstrom client debugging.

Provides namespaced logging with optional debug output.
Warnings and errors are always logged regardless of enabled state.

## Example

```typescript
const logger = new Logger(true); // Enable debug logging
logger.info('Processing message'); // Outputs: [Maelstrom] Processing message
```

## Constructors

### Constructor

> **new Logger**(`enabled?`, `namespace?`): `Logger`

Defined in: packages/client/src/lib/utils/logger.ts:23

Creates a new Logger instance.

#### Parameters

##### enabled?

`boolean` = `false`

Whether debug/info logs should be output (default: false)

##### namespace?

`string` = `'Maelstrom'`

Optional namespace prefix (default: 'Maelstrom')

#### Returns

`Logger`

## Accessors

### isEnabled

#### Get Signature

> **get** **isEnabled**(): `boolean`

Defined in: packages/client/src/lib/utils/logger.ts:31

Check if logging is enabled.

##### Returns

`boolean`

## Methods

### debug()

> **debug**(`message`, ...`args`): `void`

Defined in: packages/client/src/lib/utils/logger.ts:45

Log debug message (only if enabled).

#### Parameters

##### message

`string`

##### args

...`unknown`[]

#### Returns

`void`

***

### error()

> **error**(`message`, ...`args`): `void`

Defined in: packages/client/src/lib/utils/logger.ts:71

Log error message (always logged regardless of enabled state).

#### Parameters

##### message

`string`

##### args

...`unknown`[]

#### Returns

`void`

***

### info()

> **info**(`message`, ...`args`): `void`

Defined in: packages/client/src/lib/utils/logger.ts:54

Log info message (only if enabled).

#### Parameters

##### message

`string`

##### args

...`unknown`[]

#### Returns

`void`

***

### setEnabled()

> **setEnabled**(`value`): `void`

Defined in: packages/client/src/lib/utils/logger.ts:38

Enable or disable logging (excluding errors).

#### Parameters

##### value

`boolean`

#### Returns

`void`

***

### warn()

> **warn**(`message`, ...`args`): `void`

Defined in: packages/client/src/lib/utils/logger.ts:63

Log warning message (always logged regardless of enabled state).

#### Parameters

##### message

`string`

##### args

...`unknown`[]

#### Returns

`void`
