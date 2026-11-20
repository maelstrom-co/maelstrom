---
editUrl: false
next: false
prev: false
title: "pipeline"
---

## Call Signature

> **pipeline**\<`Out`\>(`s1`): [`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

Defined in: packages/engine/src/lib/planner/pipeline.ts:37

Composes stages into a [Planner](/reference/engine/type-aliases/planner/), feeding each stage's output to the
next. The first stage takes [PlanningInput](/reference/engine/interfaces/planninginput/), the last produces a
[PlannerCandidate](/reference/engine/type-aliases/plannercandidate/), and every adjacent pair must agree on the type in
between; a mismatch is a compile error at the offending argument. A last
stage that produces a wider [PlannerOutput](/reference/engine/type-aliases/planneroutput/) makes the result as wide,
as [PipelineOutput](/reference/engine/type-aliases/pipelineoutput/) describes: for example a `ClarifyingPlanner`
when it may ask for clarification.

Every stage receives the same [StageContext](/reference/engine/interfaces/stagecontext/), and runs wrapped by
its [StageContext.instrument](/reference/engine/interfaces/stagecontext/#instrument): once per request, just before it
runs, under the name given with [named](/reference/engine/functions/named/) or `stage-<index>`. The
first `Err`
(a `Deferred` or an `EngineError`) stops the pipeline and is returned
unchanged. If the request's signal aborts while a stage is running, the
next stage does not start and the pipeline returns a `CancellationError`.

Accepts one to nine stages.

### Type Parameters

#### Out

`Out` *extends* [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)

### Parameters

#### s1

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), `Out`\>

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

### Example

```ts
const planner = pipeline(selectVessels, arrangeLayout);
```

## Call Signature

> **pipeline**\<`A`, `Out`\>(`s1`, `s2`): [`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

Defined in: packages/engine/src/lib/planner/pipeline.ts:40

Composes stages into a [Planner](/reference/engine/type-aliases/planner/), feeding each stage's output to the
next. The first stage takes [PlanningInput](/reference/engine/interfaces/planninginput/), the last produces a
[PlannerCandidate](/reference/engine/type-aliases/plannercandidate/), and every adjacent pair must agree on the type in
between; a mismatch is a compile error at the offending argument. A last
stage that produces a wider [PlannerOutput](/reference/engine/type-aliases/planneroutput/) makes the result as wide,
as [PipelineOutput](/reference/engine/type-aliases/pipelineoutput/) describes: for example a `ClarifyingPlanner`
when it may ask for clarification.

Every stage receives the same [StageContext](/reference/engine/interfaces/stagecontext/), and runs wrapped by
its [StageContext.instrument](/reference/engine/interfaces/stagecontext/#instrument): once per request, just before it
runs, under the name given with [named](/reference/engine/functions/named/) or `stage-<index>`. The
first `Err`
(a `Deferred` or an `EngineError`) stops the pipeline and is returned
unchanged. If the request's signal aborts while a stage is running, the
next stage does not start and the pipeline returns a `CancellationError`.

Accepts one to nine stages.

### Type Parameters

#### A

`A`

#### Out

`Out` *extends* [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)

### Parameters

#### s1

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), `A`\>

#### s2

[`Stage`](/reference/engine/type-aliases/stage/)\<`A`, `Out`\>

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

### Example

```ts
const planner = pipeline(selectVessels, arrangeLayout);
```

## Call Signature

> **pipeline**\<`A`, `B`, `Out`\>(`s1`, `s2`, `s3`): [`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

Defined in: packages/engine/src/lib/planner/pipeline.ts:44

Composes stages into a [Planner](/reference/engine/type-aliases/planner/), feeding each stage's output to the
next. The first stage takes [PlanningInput](/reference/engine/interfaces/planninginput/), the last produces a
[PlannerCandidate](/reference/engine/type-aliases/plannercandidate/), and every adjacent pair must agree on the type in
between; a mismatch is a compile error at the offending argument. A last
stage that produces a wider [PlannerOutput](/reference/engine/type-aliases/planneroutput/) makes the result as wide,
as [PipelineOutput](/reference/engine/type-aliases/pipelineoutput/) describes: for example a `ClarifyingPlanner`
when it may ask for clarification.

Every stage receives the same [StageContext](/reference/engine/interfaces/stagecontext/), and runs wrapped by
its [StageContext.instrument](/reference/engine/interfaces/stagecontext/#instrument): once per request, just before it
runs, under the name given with [named](/reference/engine/functions/named/) or `stage-<index>`. The
first `Err`
(a `Deferred` or an `EngineError`) stops the pipeline and is returned
unchanged. If the request's signal aborts while a stage is running, the
next stage does not start and the pipeline returns a `CancellationError`.

Accepts one to nine stages.

### Type Parameters

#### A

`A`

#### B

`B`

#### Out

`Out` *extends* [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)

### Parameters

#### s1

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), `A`\>

#### s2

[`Stage`](/reference/engine/type-aliases/stage/)\<`A`, `B`\>

#### s3

[`Stage`](/reference/engine/type-aliases/stage/)\<`B`, `Out`\>

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

### Example

```ts
const planner = pipeline(selectVessels, arrangeLayout);
```

## Call Signature

> **pipeline**\<`A`, `B`, `C`, `Out`\>(`s1`, `s2`, `s3`, `s4`): [`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

Defined in: packages/engine/src/lib/planner/pipeline.ts:49

Composes stages into a [Planner](/reference/engine/type-aliases/planner/), feeding each stage's output to the
next. The first stage takes [PlanningInput](/reference/engine/interfaces/planninginput/), the last produces a
[PlannerCandidate](/reference/engine/type-aliases/plannercandidate/), and every adjacent pair must agree on the type in
between; a mismatch is a compile error at the offending argument. A last
stage that produces a wider [PlannerOutput](/reference/engine/type-aliases/planneroutput/) makes the result as wide,
as [PipelineOutput](/reference/engine/type-aliases/pipelineoutput/) describes: for example a `ClarifyingPlanner`
when it may ask for clarification.

Every stage receives the same [StageContext](/reference/engine/interfaces/stagecontext/), and runs wrapped by
its [StageContext.instrument](/reference/engine/interfaces/stagecontext/#instrument): once per request, just before it
runs, under the name given with [named](/reference/engine/functions/named/) or `stage-<index>`. The
first `Err`
(a `Deferred` or an `EngineError`) stops the pipeline and is returned
unchanged. If the request's signal aborts while a stage is running, the
next stage does not start and the pipeline returns a `CancellationError`.

Accepts one to nine stages.

### Type Parameters

#### A

`A`

#### B

`B`

#### C

`C`

#### Out

`Out` *extends* [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)

### Parameters

#### s1

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), `A`\>

#### s2

[`Stage`](/reference/engine/type-aliases/stage/)\<`A`, `B`\>

#### s3

[`Stage`](/reference/engine/type-aliases/stage/)\<`B`, `C`\>

#### s4

[`Stage`](/reference/engine/type-aliases/stage/)\<`C`, `Out`\>

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

### Example

```ts
const planner = pipeline(selectVessels, arrangeLayout);
```

## Call Signature

> **pipeline**\<`A`, `B`, `C`, `D`, `Out`\>(`s1`, `s2`, `s3`, `s4`, `s5`): [`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

Defined in: packages/engine/src/lib/planner/pipeline.ts:55

Composes stages into a [Planner](/reference/engine/type-aliases/planner/), feeding each stage's output to the
next. The first stage takes [PlanningInput](/reference/engine/interfaces/planninginput/), the last produces a
[PlannerCandidate](/reference/engine/type-aliases/plannercandidate/), and every adjacent pair must agree on the type in
between; a mismatch is a compile error at the offending argument. A last
stage that produces a wider [PlannerOutput](/reference/engine/type-aliases/planneroutput/) makes the result as wide,
as [PipelineOutput](/reference/engine/type-aliases/pipelineoutput/) describes: for example a `ClarifyingPlanner`
when it may ask for clarification.

Every stage receives the same [StageContext](/reference/engine/interfaces/stagecontext/), and runs wrapped by
its [StageContext.instrument](/reference/engine/interfaces/stagecontext/#instrument): once per request, just before it
runs, under the name given with [named](/reference/engine/functions/named/) or `stage-<index>`. The
first `Err`
(a `Deferred` or an `EngineError`) stops the pipeline and is returned
unchanged. If the request's signal aborts while a stage is running, the
next stage does not start and the pipeline returns a `CancellationError`.

Accepts one to nine stages.

### Type Parameters

#### A

`A`

#### B

`B`

#### C

`C`

#### D

`D`

#### Out

`Out` *extends* [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)

### Parameters

#### s1

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), `A`\>

#### s2

[`Stage`](/reference/engine/type-aliases/stage/)\<`A`, `B`\>

#### s3

[`Stage`](/reference/engine/type-aliases/stage/)\<`B`, `C`\>

#### s4

[`Stage`](/reference/engine/type-aliases/stage/)\<`C`, `D`\>

#### s5

[`Stage`](/reference/engine/type-aliases/stage/)\<`D`, `Out`\>

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

### Example

```ts
const planner = pipeline(selectVessels, arrangeLayout);
```

## Call Signature

> **pipeline**\<`A`, `B`, `C`, `D`, `E`, `Out`\>(`s1`, `s2`, `s3`, `s4`, `s5`, `s6`): [`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

Defined in: packages/engine/src/lib/planner/pipeline.ts:62

Composes stages into a [Planner](/reference/engine/type-aliases/planner/), feeding each stage's output to the
next. The first stage takes [PlanningInput](/reference/engine/interfaces/planninginput/), the last produces a
[PlannerCandidate](/reference/engine/type-aliases/plannercandidate/), and every adjacent pair must agree on the type in
between; a mismatch is a compile error at the offending argument. A last
stage that produces a wider [PlannerOutput](/reference/engine/type-aliases/planneroutput/) makes the result as wide,
as [PipelineOutput](/reference/engine/type-aliases/pipelineoutput/) describes: for example a `ClarifyingPlanner`
when it may ask for clarification.

Every stage receives the same [StageContext](/reference/engine/interfaces/stagecontext/), and runs wrapped by
its [StageContext.instrument](/reference/engine/interfaces/stagecontext/#instrument): once per request, just before it
runs, under the name given with [named](/reference/engine/functions/named/) or `stage-<index>`. The
first `Err`
(a `Deferred` or an `EngineError`) stops the pipeline and is returned
unchanged. If the request's signal aborts while a stage is running, the
next stage does not start and the pipeline returns a `CancellationError`.

Accepts one to nine stages.

### Type Parameters

#### A

`A`

#### B

`B`

#### C

`C`

#### D

`D`

#### E

`E`

#### Out

`Out` *extends* [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)

### Parameters

#### s1

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), `A`\>

#### s2

[`Stage`](/reference/engine/type-aliases/stage/)\<`A`, `B`\>

#### s3

[`Stage`](/reference/engine/type-aliases/stage/)\<`B`, `C`\>

#### s4

[`Stage`](/reference/engine/type-aliases/stage/)\<`C`, `D`\>

#### s5

[`Stage`](/reference/engine/type-aliases/stage/)\<`D`, `E`\>

#### s6

[`Stage`](/reference/engine/type-aliases/stage/)\<`E`, `Out`\>

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

### Example

```ts
const planner = pipeline(selectVessels, arrangeLayout);
```

## Call Signature

> **pipeline**\<`A`, `B`, `C`, `D`, `E`, `F`, `Out`\>(`s1`, `s2`, `s3`, `s4`, `s5`, `s6`, `s7`): [`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

Defined in: packages/engine/src/lib/planner/pipeline.ts:70

Composes stages into a [Planner](/reference/engine/type-aliases/planner/), feeding each stage's output to the
next. The first stage takes [PlanningInput](/reference/engine/interfaces/planninginput/), the last produces a
[PlannerCandidate](/reference/engine/type-aliases/plannercandidate/), and every adjacent pair must agree on the type in
between; a mismatch is a compile error at the offending argument. A last
stage that produces a wider [PlannerOutput](/reference/engine/type-aliases/planneroutput/) makes the result as wide,
as [PipelineOutput](/reference/engine/type-aliases/pipelineoutput/) describes: for example a `ClarifyingPlanner`
when it may ask for clarification.

Every stage receives the same [StageContext](/reference/engine/interfaces/stagecontext/), and runs wrapped by
its [StageContext.instrument](/reference/engine/interfaces/stagecontext/#instrument): once per request, just before it
runs, under the name given with [named](/reference/engine/functions/named/) or `stage-<index>`. The
first `Err`
(a `Deferred` or an `EngineError`) stops the pipeline and is returned
unchanged. If the request's signal aborts while a stage is running, the
next stage does not start and the pipeline returns a `CancellationError`.

Accepts one to nine stages.

### Type Parameters

#### A

`A`

#### B

`B`

#### C

`C`

#### D

`D`

#### E

`E`

#### F

`F`

#### Out

`Out` *extends* [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)

### Parameters

#### s1

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), `A`\>

#### s2

[`Stage`](/reference/engine/type-aliases/stage/)\<`A`, `B`\>

#### s3

[`Stage`](/reference/engine/type-aliases/stage/)\<`B`, `C`\>

#### s4

[`Stage`](/reference/engine/type-aliases/stage/)\<`C`, `D`\>

#### s5

[`Stage`](/reference/engine/type-aliases/stage/)\<`D`, `E`\>

#### s6

[`Stage`](/reference/engine/type-aliases/stage/)\<`E`, `F`\>

#### s7

[`Stage`](/reference/engine/type-aliases/stage/)\<`F`, `Out`\>

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

### Example

```ts
const planner = pipeline(selectVessels, arrangeLayout);
```

## Call Signature

> **pipeline**\<`A`, `B`, `C`, `D`, `E`, `F`, `G`, `Out`\>(`s1`, `s2`, `s3`, `s4`, `s5`, `s6`, `s7`, `s8`): [`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

Defined in: packages/engine/src/lib/planner/pipeline.ts:79

Composes stages into a [Planner](/reference/engine/type-aliases/planner/), feeding each stage's output to the
next. The first stage takes [PlanningInput](/reference/engine/interfaces/planninginput/), the last produces a
[PlannerCandidate](/reference/engine/type-aliases/plannercandidate/), and every adjacent pair must agree on the type in
between; a mismatch is a compile error at the offending argument. A last
stage that produces a wider [PlannerOutput](/reference/engine/type-aliases/planneroutput/) makes the result as wide,
as [PipelineOutput](/reference/engine/type-aliases/pipelineoutput/) describes: for example a `ClarifyingPlanner`
when it may ask for clarification.

Every stage receives the same [StageContext](/reference/engine/interfaces/stagecontext/), and runs wrapped by
its [StageContext.instrument](/reference/engine/interfaces/stagecontext/#instrument): once per request, just before it
runs, under the name given with [named](/reference/engine/functions/named/) or `stage-<index>`. The
first `Err`
(a `Deferred` or an `EngineError`) stops the pipeline and is returned
unchanged. If the request's signal aborts while a stage is running, the
next stage does not start and the pipeline returns a `CancellationError`.

Accepts one to nine stages.

### Type Parameters

#### A

`A`

#### B

`B`

#### C

`C`

#### D

`D`

#### E

`E`

#### F

`F`

#### G

`G`

#### Out

`Out` *extends* [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)

### Parameters

#### s1

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), `A`\>

#### s2

[`Stage`](/reference/engine/type-aliases/stage/)\<`A`, `B`\>

#### s3

[`Stage`](/reference/engine/type-aliases/stage/)\<`B`, `C`\>

#### s4

[`Stage`](/reference/engine/type-aliases/stage/)\<`C`, `D`\>

#### s5

[`Stage`](/reference/engine/type-aliases/stage/)\<`D`, `E`\>

#### s6

[`Stage`](/reference/engine/type-aliases/stage/)\<`E`, `F`\>

#### s7

[`Stage`](/reference/engine/type-aliases/stage/)\<`F`, `G`\>

#### s8

[`Stage`](/reference/engine/type-aliases/stage/)\<`G`, `Out`\>

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

### Example

```ts
const planner = pipeline(selectVessels, arrangeLayout);
```

## Call Signature

> **pipeline**\<`A`, `B`, `C`, `D`, `E`, `F`, `G`, `H`, `Out`\>(`s1`, `s2`, `s3`, `s4`, `s5`, `s6`, `s7`, `s8`, `s9`): [`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

Defined in: packages/engine/src/lib/planner/pipeline.ts:89

Composes stages into a [Planner](/reference/engine/type-aliases/planner/), feeding each stage's output to the
next. The first stage takes [PlanningInput](/reference/engine/interfaces/planninginput/), the last produces a
[PlannerCandidate](/reference/engine/type-aliases/plannercandidate/), and every adjacent pair must agree on the type in
between; a mismatch is a compile error at the offending argument. A last
stage that produces a wider [PlannerOutput](/reference/engine/type-aliases/planneroutput/) makes the result as wide,
as [PipelineOutput](/reference/engine/type-aliases/pipelineoutput/) describes: for example a `ClarifyingPlanner`
when it may ask for clarification.

Every stage receives the same [StageContext](/reference/engine/interfaces/stagecontext/), and runs wrapped by
its [StageContext.instrument](/reference/engine/interfaces/stagecontext/#instrument): once per request, just before it
runs, under the name given with [named](/reference/engine/functions/named/) or `stage-<index>`. The
first `Err`
(a `Deferred` or an `EngineError`) stops the pipeline and is returned
unchanged. If the request's signal aborts while a stage is running, the
next stage does not start and the pipeline returns a `CancellationError`.

Accepts one to nine stages.

### Type Parameters

#### A

`A`

#### B

`B`

#### C

`C`

#### D

`D`

#### E

`E`

#### F

`F`

#### G

`G`

#### H

`H`

#### Out

`Out` *extends* [`PlannerOutput`](/reference/engine/type-aliases/planneroutput/)

### Parameters

#### s1

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), `A`\>

#### s2

[`Stage`](/reference/engine/type-aliases/stage/)\<`A`, `B`\>

#### s3

[`Stage`](/reference/engine/type-aliases/stage/)\<`B`, `C`\>

#### s4

[`Stage`](/reference/engine/type-aliases/stage/)\<`C`, `D`\>

#### s5

[`Stage`](/reference/engine/type-aliases/stage/)\<`D`, `E`\>

#### s6

[`Stage`](/reference/engine/type-aliases/stage/)\<`E`, `F`\>

#### s7

[`Stage`](/reference/engine/type-aliases/stage/)\<`F`, `G`\>

#### s8

[`Stage`](/reference/engine/type-aliases/stage/)\<`G`, `H`\>

#### s9

[`Stage`](/reference/engine/type-aliases/stage/)\<`H`, `Out`\>

### Returns

[`Stage`](/reference/engine/type-aliases/stage/)\<[`PlanningInput`](/reference/engine/interfaces/planninginput/), [`PipelineOutput`](/reference/engine/type-aliases/pipelineoutput/)\<`Out`\>\>

### Example

```ts
const planner = pipeline(selectVessels, arrangeLayout);
```
