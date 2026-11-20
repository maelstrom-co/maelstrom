---
editUrl: false
next: false
prev: false
title: "ConnectorCapabilities"
---

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:82

Capabilities of a connector implementation.

These are metadata declarations for consumers (e.g., UI that wants to
show/hide a voice button). The ConnectionManager does NOT use these flags
to change its behavior — it is transport-agnostic.

## Properties

### stateful

> `readonly` **stateful**: `boolean`

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:88

Whether the connector maintains a persistent connection (WebSocket vs HTTP)

***

### streaming

> `readonly` **streaming**: `boolean`

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:86

Whether the connector supports bidirectional streaming

***

### voice

> `readonly` **voice**: `boolean`

Defined in: packages/client/src/lib/connection-manager/connector.types.ts:84

Whether the connector supports voice/audio streaming
