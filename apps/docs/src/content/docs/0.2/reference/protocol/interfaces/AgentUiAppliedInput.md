---
editUrl: false
next: false
prev: false
title: "AgentUiAppliedInput"
---

Defined in: packages/protocol/src/lib/agent-wire.ts:156

The browser's acknowledgement that it applied a UI change.

## Properties

### actionOutcomes

> **actionOutcomes**: [`AgentActionOutcome`](/reference/protocol/interfaces/agentactionoutcome/)[]

Defined in: packages/protocol/src/lib/agent-wire.ts:169

One outcome per Action in the Execution Plan. Positional: entry i
describes Action i of the Execution Plan.

***

### changeId

> **changeId**: [`ChangeId`](/reference/protocol/type-aliases/changeid/)

Defined in: packages/protocol/src/lib/agent-wire.ts:162

Echoes the `changeId` of the applied `ui_change`.

***

### chart

> **chart**: [`ChartRequest`](/reference/protocol/interfaces/chartrequest/)

Defined in: packages/protocol/src/lib/agent-wire.ts:164

Chart state after the change was applied.

***

### type

> **type**: `"ui_applied"`

Defined in: packages/protocol/src/lib/agent-wire.ts:158

Member discriminator.

***

### version

> **version**: `1`

Defined in: packages/protocol/src/lib/agent-wire.ts:160

Agent wire version, always [AGENT\_WIRE\_VERSION](/reference/protocol/variables/agent_wire_version/).
