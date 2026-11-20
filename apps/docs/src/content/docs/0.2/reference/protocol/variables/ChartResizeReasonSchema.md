---
editUrl: false
next: false
prev: false
title: "ChartResizeReasonSchema"
---

> `const` **ChartResizeReasonSchema**: `ZodObject`\<\{ `current`: `ZodObject`\<\{ `columns`: `ZodNumber`; `rows`: `ZodNumber`; \}, `$strip`\>; `previous`: `ZodObject`\<\{ `columns`: `ZodNumber`; `rows`: `ZodNumber`; \}, `$strip`\>; `type`: `ZodLiteral`\<`"chart_resize"`\>; \}, `$strip`\>

Defined in: packages/protocol/src/lib/request.ts:82

Wire-format Zod parser for [ChartResizeReason](/reference/protocol/interfaces/chartresizereason/). Both `previous` and
`current` are full [ChartDimensionsSchema](/reference/protocol/variables/chartdimensionsschema/) objects (positive integer
rows + columns) — a resize event must always carry the before/after
shape, not a delta.
