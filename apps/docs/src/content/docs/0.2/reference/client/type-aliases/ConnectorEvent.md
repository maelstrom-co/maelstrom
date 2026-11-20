---
editUrl: false
next: false
prev: false
title: "ConnectorEvent"
---

> **ConnectorEvent** = \{ `clean`: `boolean`; `message`: `string`; `retryable?`: `boolean`; `type`: `"disconnected"`; \} \| \{ `error`: `Error`; `type`: `"error"`; \}

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:105

Transport-level events emitted by a connector via `subscribe()`.

These are the only events the ConnectionManager needs from a connector:
- `'disconnected'`: the transport closed, cleanly or unexpectedly.
- `'error'`: a transport-level error occurred (distinct from a disconnection).

There is intentionally no `'connected'` event. `connect()` resolving is the
signal that the connection is ready — no separate subscription needed.
