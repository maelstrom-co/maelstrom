---
editUrl: false
next: false
prev: false
title: "AgentErrorEvent"
---

Defined in: packages/protocol/src/lib/agent-wire.ts:378

A failure outside any Agent Run.

## Properties

### changeId?

> `optional` **changeId?**: [`ChangeId`](/reference/protocol/type-aliases/changeid/)

Defined in: packages/protocol/src/lib/agent-wire.ts:390

The UI change the failure belongs to. Set for failures of a `ui_applied`
input, such as an unknown or stale `changeId`, because that input carries
no `inputId`.

***

### code?

> `optional` **code?**: `string`

Defined in: packages/protocol/src/lib/agent-wire.ts:394

Optional machine-readable failure kind with no closed taxonomy.

***

### error

> **error**: `string`

Defined in: packages/protocol/src/lib/agent-wire.ts:392

Human-readable failure description.

***

### inputId?

> `optional` **inputId?**: [`MessageId`](/reference/protocol/type-aliases/messageid/)

Defined in: packages/protocol/src/lib/agent-wire.ts:384

The offending input, when there is one.

***

### type

> **type**: `"error"`

Defined in: packages/protocol/src/lib/agent-wire.ts:380

Member discriminator.

***

### version

> **version**: `1`

Defined in: packages/protocol/src/lib/agent-wire.ts:382

Agent wire version, always [AGENT\_WIRE\_VERSION](/reference/protocol/variables/agent_wire_version/).
