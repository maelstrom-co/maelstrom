---
editUrl: false
next: false
prev: false
title: "ConnectionManagerState"
---

> **ConnectionManagerState** = `object`

Defined in: packages/client/src/lib/connection-manager/connection-manager.state.ts:4

Observable transport, retry, and circuit-breaker state.

## Properties

### circuitBreakerStatus

> **circuitBreakerStatus**: [`CircuitStatus`](/reference/client/type-aliases/circuitstatus/)

Defined in: packages/client/src/lib/connection-manager/connection-manager.state.ts:8

Current circuit-breaker phase.

***

### connectionError

> **connectionError**: `Error` \| `null`

Defined in: packages/client/src/lib/connection-manager/connection-manager.state.ts:12

Most recent connection failure, or `null` when none is retained.

***

### connectionRetryCount

> **connectionRetryCount**: `number`

Defined in: packages/client/src/lib/connection-manager/connection-manager.state.ts:10

Number of retry attempts charged to the current retry budget.

***

### connectionStatus

> **connectionStatus**: [`ConnectionStatus`](/reference/client/type-aliases/connectionstatus/)

Defined in: packages/client/src/lib/connection-manager/connection-manager.state.ts:6

Current engine-connection lifecycle status.

***

### lastConnectedAt

> **lastConnectedAt**: `number` \| `null`

Defined in: packages/client/src/lib/connection-manager/connection-manager.state.ts:14

Epoch milliseconds of the latest successful connection.

***

### lastDisconnectedAt

> **lastDisconnectedAt**: `number` \| `null`

Defined in: packages/client/src/lib/connection-manager/connection-manager.state.ts:16

Epoch milliseconds of the latest disconnection.
