---
editUrl: false
next: false
prev: false
title: "Instrument"
---

Defined in: packages/engine/src/lib/planner/instrument.ts:39

The telemetry seam of the planner. The Engine takes one from
`EngineConfig.instrument` (default [noopInstrument](/reference/engine/variables/noopinstrument/)) and hands it to
every stage as `StageContext.instrument`.

[pipeline](/reference/engine/functions/pipeline/) wraps each of its stages with [Instrument.stage](/reference/engine/interfaces/instrument/#stage)
once per request, before running it. Stages and the clients they call
report what happens inside them with [Instrument.event](/reference/engine/interfaces/instrument/#event).

## Example

```ts
const loggingInstrument: Instrument = {
  stage: (name, stage) => async (input, ctx) => {
    const started = performance.now();
    const result = await stage(input, ctx);
    console.info('stage', name, performance.now() - started);
    return result;
  },
  event: (name, attributes) => console.info(name, attributes),
};
const engine = createEngine({ planner, instrument: loggingInstrument });
```

## Methods

### event()

> **event**(`name`, `attributes`): `void`

Defined in: packages/engine/src/lib/planner/instrument.ts:55

Reports one thing that happened inside a stage, such as a model call.
Names are dotted lower-case strings owned by the emitter (for example
`llm.call`). Must not throw.

#### Parameters

##### name

`string`

##### attributes

[`InstrumentAttributes`](/reference/engine/type-aliases/instrumentattributes/)

#### Returns

`void`

***

### stage()

> **stage**\<`In`, `Out`\>(`name`, `stage`): [`Stage`](/reference/engine/type-aliases/stage/)\<`In`, `Out`\>

Defined in: packages/engine/src/lib/planner/instrument.ts:49

Wraps one stage of a pipeline for one request. Return `stage` itself, a
stage that calls through to it (to time or trace it), or a different
stage entirely (for example one that replays a recorded output).

#### Type Parameters

##### In

`In`

##### Out

`Out`

#### Parameters

##### name

`string`

The name given with [named](/reference/engine/functions/named/), or `stage-<index>` for
  an unnamed stage, counting from 0 within its pipeline.

##### stage

[`Stage`](/reference/engine/type-aliases/stage/)\<`In`, `Out`\>

The stage about to run.

#### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<`In`, `Out`\>
