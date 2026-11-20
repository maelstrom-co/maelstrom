---
editUrl: false
next: false
prev: false
title: "DEFAULT_LAYOUT_MODE"
---

> `const` **DEFAULT\_LAYOUT\_MODE**: `LayoutMode` = `'tiling'`

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:134

Layout mode applied when [TilingOrchestratorOptions.layoutMode](/reference/client/interfaces/tilingorchestratoroptions/#layoutmode) is
omitted. The one definition of that default — resolveOrchestratorOptions
consumes it internally, and consumers that need to know it (a "reset to
default" control, for example) should import this constant rather than
duplicating the literal.
