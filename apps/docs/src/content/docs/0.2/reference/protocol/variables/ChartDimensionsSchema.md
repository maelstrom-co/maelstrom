---
editUrl: false
next: false
prev: false
title: "ChartDimensionsSchema"
---

> `const` **ChartDimensionsSchema**: `ZodObject`\<\{ `columns`: `ZodNumber`; `rows`: `ZodNumber`; \}, `$strip`\>

Defined in: packages/protocol/src/lib/chart.ts:32

Wire-format Zod parser for [ChartDimensions](/reference/protocol/interfaces/chartdimensions/). Both `rows` and
`columns` must be positive integers — a chart with zero of either has
no cells and is meaningless to lay out into.
