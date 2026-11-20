---
editUrl: false
next: false
prev: false
title: "ResolvedOrchestratorOptions"
---

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:117

Resolved configuration with defaults applied.

Every field is `readonly` because [Orchestrator.getConfig](/reference/client/classes/orchestrator/#getconfig) hands out
the live object, not a copy: the Orchestrator replaces this object wholesale
when a setter changes a field (see `setLayoutMode`), so a caller writing
through the returned reference would bypass whatever else that setter owns
— and `sessionId` is captured-once identity that nothing may rewrite.

## Properties

### connection

> `readonly` **connection**: [`ConnectionOptions`](/reference/client/interfaces/connectionoptions/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:124

***

### debounceDelayMs

> `readonly` **debounceDelayMs**: `number`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:121

***

### debug

> `readonly` **debug**: `boolean`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:120

***

### layoutMode

> `readonly` **layoutMode**: `LayoutMode`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:119

***

### maxWaitMs

> `readonly` **maxWaitMs**: `number`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:122

***

### readyTimeoutMs

> `readonly` **readyTimeoutMs**: `number`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:123

***

### sessionId

> `readonly` **sessionId**: [`SessionId`](/reference/client/type-aliases/sessionid/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:118
