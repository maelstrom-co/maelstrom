---
editUrl: false
next: false
prev: false
title: "OrchestratorOptions"
---

> **OrchestratorOptions** = [`TilingOrchestratorOptions`](/reference/client/interfaces/tilingorchestratoroptions/) \| [`GridOrchestratorOptions`](/reference/client/interfaces/gridorchestratoroptions/)

Defined in: packages/client/src/lib/orchestrator/orchestrator.types.ts:104

Configuration options for the Orchestrator / Maelstrom client.

`layoutMode` and `initialLayout` are one paired choice rather than two
independent fields: seeding a first screen is meaningful only under
tiling, so the grid arm makes `initialLayout` unrepresentable instead of
leaving that combination to a construction-time throw.
