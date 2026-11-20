---
editUrl: false
next: false
prev: false
title: "GridOrchestratorOptions"
---

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:84

Options under grid mode, where no first screen can be seeded.

## Extends

- [`OrchestratorOptionsBase`](/reference/client/interfaces/orchestratoroptionsbase/)

## Properties

### connection?

> `optional` **connection?**: `Partial`\<[`ConnectionOptions`](/reference/client/interfaces/connectionoptions/)\>

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:30

Connection options for the ConnectionManager

#### Inherited from

[`OrchestratorOptionsBase`](/reference/client/interfaces/orchestratoroptionsbase/).[`connection`](/reference/client/interfaces/orchestratoroptionsbase/#connection)

***

### debounceDelayMs?

> `optional` **debounceDelayMs?**: `number`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:24

Debounce delay for update batching in ms (default: 300)

#### Inherited from

[`OrchestratorOptionsBase`](/reference/client/interfaces/orchestratoroptionsbase/).[`debounceDelayMs`](/reference/client/interfaces/orchestratoroptionsbase/#debouncedelayms)

***

### debug?

> `optional` **debug?**: `boolean`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:22

Enable debug logging (default: false)

#### Inherited from

[`OrchestratorOptionsBase`](/reference/client/interfaces/orchestratoroptionsbase/).[`debug`](/reference/client/interfaces/orchestratoroptionsbase/#debug)

***

### initialLayout?

> `optional` **initialLayout?**: `undefined`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:93

Unavailable under grid mode. A seed has to *create* the instances it
arranges, which only a tiling tree expresses; grid positions can merely
move instances that already exist. Seed under
[TilingOrchestratorOptions.initialLayout](/reference/client/interfaces/tilingorchestratoroptions/#initiallayout) instead.

***

### intentQueue?

> `optional` **intentQueue?**: [`IntentQueueOptions`](/reference/client/interfaces/intentqueueoptions/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:18

Mount-time bounded FIFO policy; invalid positive bounds throw at construction.

#### Inherited from

[`OrchestratorOptionsBase`](/reference/client/interfaces/orchestratoroptionsbase/).[`intentQueue`](/reference/client/interfaces/orchestratoroptionsbase/#intentqueue)

***

### layoutMode

> **layoutMode**: `"grid"`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:86

Layout mode.

***

### maxWaitMs?

> `optional` **maxWaitMs?**: `number`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:26

Maximum wait time before forcing an update flush in ms (default: 1000)

#### Inherited from

[`OrchestratorOptionsBase`](/reference/client/interfaces/orchestratoroptionsbase/).[`maxWaitMs`](/reference/client/interfaces/orchestratoroptionsbase/#maxwaitms)

***

### readyTimeoutMs?

> `optional` **readyTimeoutMs?**: `number`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:28

Max wait time for instance readiness before skipping actions in ms (default: 500)

#### Inherited from

[`OrchestratorOptionsBase`](/reference/client/interfaces/orchestratoroptionsbase/).[`readyTimeoutMs`](/reference/client/interfaces/orchestratoroptionsbase/#readytimeoutms)

***

### sessionId?

> `optional` **sessionId?**: [`SessionId`](/reference/client/type-aliases/sessionid/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:20

Session ID for conversation continuity. Auto-generated if omitted.

#### Inherited from

[`OrchestratorOptionsBase`](/reference/client/interfaces/orchestratoroptionsbase/).[`sessionId`](/reference/client/interfaces/orchestratoroptionsbase/#sessionid)

***

### vessels?

> `optional` **vessels?**: readonly `VesselDefinition`[]

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:46

Vessel definitions to register before
[TilingOrchestratorOptions.initialLayout](/reference/client/interfaces/tilingorchestratoroptions/#initiallayout) is validated and applied.
Equivalent to calling `vesselManager.registerVessel()` for each
immediately after construction — including its report-don't-throw
behavior: a definition that fails schema validation is skipped and
logged rather than aborting construction, so one bad vessel cannot take
down every other vessel. Registering here (rather than after
construction) exists so an `initialLayout` seed can reference these
vessels — the registry starts out empty otherwise. The one place this
still throws is indirect: if `initialLayout` names an instance whose
vessel failed validation (or was never listed here), construction
throws naming that instance and vessel — a seed genuinely cannot be
honored without the vessel it names.

#### Inherited from

[`OrchestratorOptionsBase`](/reference/client/interfaces/orchestratoroptionsbase/).[`vessels`](/reference/client/interfaces/orchestratoroptionsbase/#vessels)
