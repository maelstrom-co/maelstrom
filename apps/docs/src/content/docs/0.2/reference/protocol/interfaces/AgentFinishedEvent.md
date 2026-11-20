---
editUrl: false
next: false
prev: false
title: "AgentFinishedEvent"
---

Defined in: packages/protocol/src/lib/agent-wire.ts:329

The end of an Agent Run with its structured outcome.

## Properties

### code?

> `optional` **code?**: `string`

Defined in: packages/protocol/src/lib/agent-wire.ts:356

Optional machine-readable failure kind with no closed taxonomy, same
meaning as on the `error` event.

***

### error?

> `optional` **error?**: `string`

Defined in: packages/protocol/src/lib/agent-wire.ts:351

Human-readable failure description when `ok` is `false`.

***

### metrics

> **metrics**: [`AgentRunMetrics`](/reference/protocol/interfaces/agentrunmetrics/)

Defined in: packages/protocol/src/lib/agent-wire.ts:349

Cost counters for the run.

***

### ok

> **ok**: `boolean`

Defined in: packages/protocol/src/lib/agent-wire.ts:340

`true` when the run ended as intended (`completed`, `waiting`), `false`
for `cancelled`, `budget` and `error`.

***

### reason

> **reason**: `"error"` \| `"completed"` \| `"waiting"` \| `"cancelled"` \| `"budget"`

Defined in: packages/protocol/src/lib/agent-wire.ts:342

Why the run ended.

***

### reply

> **reply**: `string`

Defined in: packages/protocol/src/lib/agent-wire.ts:347

Full text of the final reply, empty when the run ended before producing
one.

***

### runId

> **runId**: [`RunId`](/reference/protocol/type-aliases/runid/)

Defined in: packages/protocol/src/lib/agent-wire.ts:335

The Agent Run that ended.

***

### type

> **type**: `"finished"`

Defined in: packages/protocol/src/lib/agent-wire.ts:331

Member discriminator.

***

### version

> **version**: `1`

Defined in: packages/protocol/src/lib/agent-wire.ts:333

Agent wire version, always [AGENT\_WIRE\_VERSION](/reference/protocol/variables/agent_wire_version/).
