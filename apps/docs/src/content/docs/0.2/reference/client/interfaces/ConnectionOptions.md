---
editUrl: false
next: false
prev: false
title: "ConnectionOptions"
---

Defined in: packages/client/src/lib/connection-manager/connection-manager.types.ts:6

Retry and circuit-breaker policy for an engine connection.

## Properties

### backoffMultiplier

> **backoffMultiplier**: `number`

Defined in: packages/client/src/lib/connection-manager/connection-manager.types.ts:18

Multiplier applied to each successive retry delay.

***

### circuitBreakerTimeoutMs

> **circuitBreakerTimeoutMs**: `number`

Defined in: packages/client/src/lib/connection-manager/connection-manager.types.ts:20

Delay before an open circuit attempts a half-open probe.

***

### initialDelayMs

> **initialDelayMs**: `number`

Defined in: packages/client/src/lib/connection-manager/connection-manager.types.ts:14

Delay before the first retry, in milliseconds.

***

### maxDelayMs

> **maxDelayMs**: `number`

Defined in: packages/client/src/lib/connection-manager/connection-manager.types.ts:16

Upper bound for an individual retry delay, in milliseconds.

***

### maxRetries

> **maxRetries**: `number`

Defined in: packages/client/src/lib/connection-manager/connection-manager.types.ts:12

Maximum connection attempts before the circuit opens. This includes the
initial [ConnectionManager.connect](/reference/client/classes/connectionmanager/#connect) attempt and separately caps
automatic reconnects after a dropped connection.

***

### stabilityThresholdMs?

> `optional` **stabilityThresholdMs?**: `number`

Defined in: packages/client/src/lib/connection-manager/connection-manager.types.ts:41

How long (ms) a connection must stay up before `connectionRetryCount` is
reset to 0. A successful `connect()` no longer resets the retry budget
immediately — it only proves the connection *opened*, not that it's
usable. A server that accepts a socket and immediately closes it again
(a mis-set-up session engine, a rejected handshake) would otherwise reset
the counter on every cycle and retry forever without ever exhausting
`maxRetries` or opening the circuit breaker. If the connection drops
before this elapses, the pending reset is cancelled and the retry count
keeps climbing from where it left off — a reconnect that doesn't survive
the window is treated as having failed, not recovered, so it still
counts against the retry budget.

Optional — defaults to 5000ms, chosen against the default backoff
schedule (`initialDelayMs: 1000`, `backoffMultiplier: 2`): the first
three reconnect delays sum to ~1000+2000+4000=7000ms, so a connection
that keeps dying immediately after opening never accumulates 5s of
uptime between drops and the counter never resets — while a connection
that genuinely stays up for 5s is a reasonable bar for "stable."
