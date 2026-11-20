---
editUrl: false
next: false
prev: false
title: "SessionLifecycleEvent"
---

> **SessionLifecycleEvent** = [`SessionStartedEvent`](/reference/realtime/interfaces/sessionstartedevent/) \| \{ `generation`: `number`; `type`: `"session.connected"`; \} \| \{ `generation`: `number`; `type`: `"session.disconnecting"`; \} \| \{ `generation`: `number`; `type`: `"session.disconnected"`; \} \| \{ `generation`: `number`; `type`: `"session.error"`; \}

Defined in: packages/realtime/src/lib/realtime-session/session-event-bus.ts:31

Connection lifecycle facts. Only the session knows them.

## Union Members

[`SessionStartedEvent`](/reference/realtime/interfaces/sessionstartedevent/)

***

### Type Literal

\{ `generation`: `number`; `type`: `"session.connected"`; \}

#### generation

> `readonly` **generation**: `number`

Connection generation the fact belongs to.

#### type

> `readonly` **type**: `"session.connected"`

The provider connection of this generation is established.

***

### Type Literal

\{ `generation`: `number`; `type`: `"session.disconnecting"`; \}

#### generation

> `readonly` **generation**: `number`

Connection generation the fact belongs to.

#### type

> `readonly` **type**: `"session.disconnecting"`

Local teardown of this generation began.

***

### Type Literal

\{ `generation`: `number`; `type`: `"session.disconnected"`; \}

#### generation

> `readonly` **generation**: `number`

Connection generation the fact belongs to.

#### type

> `readonly` **type**: `"session.disconnected"`

The session is dormant after teardown.

***

### Type Literal

\{ `generation`: `number`; `type`: `"session.error"`; \}

#### generation

> `readonly` **generation**: `number`

Connection generation the fact belongs to.

#### type

> `readonly` **type**: `"session.error"`

The connection of this generation failed.
