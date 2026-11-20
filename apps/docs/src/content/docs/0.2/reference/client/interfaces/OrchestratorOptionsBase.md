---
editUrl: false
next: false
prev: false
title: "OrchestratorOptionsBase"
---

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:16

Options that apply under every layout mode.

[OrchestratorOptions](/reference/client/type-aliases/orchestratoroptions/) pairs these with the mode-specific
`layoutMode` / `initialLayout` fields.

## Extended by

- [`GridOrchestratorOptions`](/reference/client/interfaces/gridorchestratoroptions/)
- [`TilingOrchestratorOptions`](/reference/client/interfaces/tilingorchestratoroptions/)

## Properties

### connection?

> `optional` **connection?**: `Partial`\<[`ConnectionOptions`](/reference/client/interfaces/connectionoptions/)\>

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:30

Connection options for the ConnectionManager

***

### debounceDelayMs?

> `optional` **debounceDelayMs?**: `number`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:24

Debounce delay for update batching in ms (default: 300)

***

### debug?

> `optional` **debug?**: `boolean`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:22

Enable debug logging (default: false)

***

### intentQueue?

> `optional` **intentQueue?**: [`IntentQueueOptions`](/reference/client/interfaces/intentqueueoptions/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:18

Mount-time bounded FIFO policy; invalid positive bounds throw at construction.

***

### maxWaitMs?

> `optional` **maxWaitMs?**: `number`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:26

Maximum wait time before forcing an update flush in ms (default: 1000)

***

### readyTimeoutMs?

> `optional` **readyTimeoutMs?**: `number`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:28

Max wait time for instance readiness before skipping actions in ms (default: 500)

***

### sessionId?

> `optional` **sessionId?**: [`SessionId`](/reference/client/type-aliases/sessionid/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:20

Session ID for conversation continuity. Auto-generated if omitted.

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
