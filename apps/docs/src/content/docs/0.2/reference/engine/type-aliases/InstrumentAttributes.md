---
editUrl: false
next: false
prev: false
title: "InstrumentAttributes"
---

> **InstrumentAttributes** = `Readonly`\<`Record`\<`string`, `string` \| `number` \| `boolean`\>\>

Defined in: packages/engine/src/lib/planner/instrument.ts:12

Flat attributes of one [Instrument.event](/reference/engine/interfaces/instrument/#event). Values are scalars only;
anything structured belongs somewhere other than the telemetry seam.

Keys at provider call sites use the OpenTelemetry GenAI names verbatim
(`gen_ai.request.model`, `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`); Maelstrom-specific keys are prefixed
`maelstrom.` (for example `maelstrom.stage`, `maelstrom.latency_ms`).
