---
editUrl: false
next: false
prev: false
title: "TilingOrchestratorOptions"
---

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:53

Options under the default tiling mode — the only mode that can seed a
first screen.

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

> `optional` **initialLayout?**: `TilingLayout`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:78

Layout applied once at construction, before any engine round-trip — a
*proposed* first screen. The engine sees it in the next chart request
and may reshape or drop tiles to fit the real viewport.

Tiling-only, and typed that way: a grid layout can only reposition
instances that already exist, and none do yet at construction, so
[GridOrchestratorOptions](/reference/client/interfaces/gridorchestratoroptions/) types `initialLayout` as `never`. The
constructor repeats both rules at runtime as a backstop for untyped
(JS) callers and `as` casts.

Every instance the seed names must resolve to a vessel and variant
already registered via [OrchestratorOptionsBase.vessels](/reference/client/interfaces/orchestratoroptionsbase/#vessels), every
`tree` leaf must be declared in `instances`, and every declared
instance must appear as a `tree` leaf; otherwise construction throws.

Switching to grid later via `Orchestrator.setLayoutMode('grid')` is not
an error and does not undo the seed's own validity — but the stored
tiling layout can no longer be sent, so the next chart request carries
a fresh empty grid layout and the arranged board is discarded (with a
warning).

***

### intentQueue?

> `optional` **intentQueue?**: [`IntentQueueOptions`](/reference/client/interfaces/intentqueueoptions/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:18

Mount-time bounded FIFO policy; invalid positive bounds throw at construction.

#### Inherited from

[`OrchestratorOptionsBase`](/reference/client/interfaces/orchestratoroptionsbase/).[`intentQueue`](/reference/client/interfaces/orchestratoroptionsbase/#intentqueue)

***

### layoutMode?

> `optional` **layoutMode?**: `"tiling"`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:55

Layout mode (default: 'tiling')

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
