---
editUrl: false
next: false
prev: false
title: "OpenConnectionOptions"
---

Defined in: packages/engine/src/lib/agent-session/connection.ts:12

Server-owned context and clock for one connection. Never supplied to the Planner.

## Properties

### acknowledgementTimeoutMs?

> `readonly` `optional` **acknowledgementTimeoutMs?**: `number`

Defined in: packages/engine/src/lib/agent-session/connection.ts:31

Maximum wait in milliseconds for the browser to acknowledge a UI change
with `ui_applied`. Defaults to 30,000. Must be a positive integer no
greater than 2,147,483,647, or opening the connection throws. When it
elapses, the run finishes with code `ui_ack_timeout`, every queued
utterance finishes as `cancelled`, and the next utterance plans against
its own Chart.

***

### capabilities?

> `readonly` `optional` **capabilities?**: `unknown`

Defined in: packages/engine/src/lib/agent-session/connection.ts:20

Browser capability manifest, opaque until Client Tools are configured.

***

### clock?

> `readonly` `optional` **clock?**: () => `number`

Defined in: packages/engine/src/lib/agent-session/connection.ts:22

Monotonic millisecond clock for measuring run duration. Defaults to performance.now.

#### Returns

`number`

***

### sessionId

> `readonly` **sessionId**: `SessionId`

Defined in: packages/engine/src/lib/agent-session/connection.ts:14

Session the host authorized before opening this connection.

***

### token?

> `readonly` `optional` **token?**: `string`

Defined in: packages/engine/src/lib/agent-session/connection.ts:18

Optional application credential. Provider API keys do not belong here.

***

### user

> `readonly` **user**: `unknown`

Defined in: packages/engine/src/lib/agent-session/connection.ts:16

Host-authenticated principal, opaque to the UI-only route. Use null for anonymous applications.
