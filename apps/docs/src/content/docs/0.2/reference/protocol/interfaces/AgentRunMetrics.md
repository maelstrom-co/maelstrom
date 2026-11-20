---
editUrl: false
next: false
prev: false
title: "AgentRunMetrics"
---

Defined in: packages/protocol/src/lib/agent-wire.ts:99

Counters describing the cost of one Agent Run.

## Properties

### elapsedMs

> **elapsedMs**: `number`

Defined in: packages/protocol/src/lib/agent-wire.ts:105

Wall-clock duration of the run in milliseconds.

***

### inputTokens

> **inputTokens**: `number`

Defined in: packages/protocol/src/lib/agent-wire.ts:107

Model input tokens consumed.

***

### outputTokens

> **outputTokens**: `number`

Defined in: packages/protocol/src/lib/agent-wire.ts:109

Model output tokens produced.

***

### toolCalls

> **toolCalls**: `number`

Defined in: packages/protocol/src/lib/agent-wire.ts:103

Tool calls made across all turns.

***

### turns

> **turns**: `number`

Defined in: packages/protocol/src/lib/agent-wire.ts:101

Loop model turns taken.
