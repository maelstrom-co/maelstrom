---
editUrl: false
next: false
prev: false
title: "ConnectionManagerEvents"
---

> **ConnectionManagerEvents** = `object`

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:22

Event payloads emitted by ConnectionManager.

## Properties

### circuit\_closed

> **circuit\_closed**: `Record`\<`string`, `never`\>

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:41

***

### circuit\_half\_open

> **circuit\_half\_open**: `Record`\<`string`, `never`\>

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:42

***

### circuit\_opened

> **circuit\_opened**: `object`

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:40

The breaker opened. `resetAfterMs` is when the half-open probe is due —
unless `terminal` is true, in which case no probe is scheduled and
`resetAfterMs` is not honoured.

`terminal` means the server refused this client outright (a
`retryable: false` disconnect, e.g. RFC 6455 close code 1008), so
reconnecting on the same session cannot succeed and would only add load.
Recovery there is an explicit user action — typically a reload, which
mints a fresh session — not a timer.

#### resetAfterMs

> **resetAfterMs**: `number`

#### terminal?

> `optional` **terminal?**: `boolean`

***

### connection\_attempt

> **connection\_attempt**: `object`

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:27

#### attempt

> **attempt**: `number`

#### maxAttempts

> **maxAttempts**: `number`

***

### connection\_error

> **connection\_error**: `object`

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:28

#### attempt

> **attempt**: `number`

#### error

> **error**: `Error`

***

### connection\_status\_changed

> **connection\_status\_changed**: `object`

Defined in: packages/client/src/lib/connection-manager/connection-manager.ts:23

#### previousStatus

> **previousStatus**: [`ConnectionStatus`](/reference/client/type-aliases/connectionstatus/)

#### status

> **status**: [`ConnectionStatus`](/reference/client/type-aliases/connectionstatus/)
