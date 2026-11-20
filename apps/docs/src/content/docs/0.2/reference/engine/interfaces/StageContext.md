---
editUrl: false
next: false
prev: false
title: "StageContext"
---

Defined in: packages/engine/src/lib/planner/stage.ts:77

Request-scoped services the Engine gives every stage of a [Planner](/reference/engine/type-aliases/planner/).

## Properties

### enumSnapshot?

> `readonly` `optional` **enumSnapshot?**: [`ActionParameterEnumSnapshot`](/reference/engine/interfaces/actionparameterenumsnapshot/)

Defined in: packages/engine/src/lib/planner/stage.ts:106

The Action parameter enum values [StageContext.validate](/reference/engine/interfaces/stagecontext/#validate) checks
actions against, captured once from the Vessel catalog in
[StageContext.origin](/reference/engine/interfaces/stagecontext/#origin). A stage that renders enum values for that
same catalog (for example into a prompt) should read them from here, so
it shows exactly the literals validation accepts even for values whose
serialization is not stable across calls. The Engine always sets it;
combinators that derive a context must forward it unchanged.

***

### instrument

> `readonly` **instrument**: [`Instrument`](/reference/engine/interfaces/instrument/)

Defined in: packages/engine/src/lib/planner/stage.ts:92

The Engine's telemetry seam. [pipeline](/reference/engine/functions/pipeline/) wraps every stage with it;
a stage reports what happens inside it (for example a model call) with
`instrument.event`. The Engine always sets it, to a no-op when none is
configured; combinators that derive a context must forward it unchanged.

***

### logger

> `readonly` **logger**: [`Logger`](/reference/engine/interfaces/logger/)

Defined in: packages/engine/src/lib/planner/stage.ts:85

The Engine's logger. Log through it so stage logs share the Engine's sink and redaction.

***

### origin

> `readonly` **origin**: [`PlanningInput`](/reference/engine/interfaces/planninginput/)

Defined in: packages/engine/src/lib/planner/stage.ts:94

The untouched input the Engine passed to the first stage.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: packages/engine/src/lib/planner/stage.ts:83

Cancels in-flight work for the request. Every stage must honour it so
that cancelled requests, and later concurrent combinators, stop spending
on work nobody will use.

***

### validate

> `readonly` **validate**: \{(`candidate`): `Result`\<[`ValidatedCandidate`](/reference/engine/type-aliases/validatedcandidate/), [`EngineError`](/reference/engine/type-aliases/engineerror/)\>; (`candidate`): `Result`\<[`ValidatedReplylessCandidate`](/reference/engine/type-aliases/validatedreplylesscandidate/), [`EngineError`](/reference/engine/type-aliases/engineerror/)\>; \}

Defined in: packages/engine/src/lib/planner/stage.ts:96

Heals and validates a candidate against the request in [StageContext.origin](/reference/engine/interfaces/stagecontext/#origin).

#### Call Signature

> (`candidate`): `Result`\<[`ValidatedCandidate`](/reference/engine/type-aliases/validatedcandidate/), [`EngineError`](/reference/engine/type-aliases/engineerror/)\>

##### Parameters

###### candidate

[`PlannerCandidate`](/reference/engine/type-aliases/plannercandidate/)

##### Returns

`Result`\<[`ValidatedCandidate`](/reference/engine/type-aliases/validatedcandidate/), [`EngineError`](/reference/engine/type-aliases/engineerror/)\>

#### Call Signature

> (`candidate`): `Result`\<[`ValidatedReplylessCandidate`](/reference/engine/type-aliases/validatedreplylesscandidate/), [`EngineError`](/reference/engine/type-aliases/engineerror/)\>

##### Parameters

###### candidate

[`ReplylessCandidate`](/reference/engine/type-aliases/replylesscandidate/)

##### Returns

`Result`\<[`ValidatedReplylessCandidate`](/reference/engine/type-aliases/validatedreplylesscandidate/), [`EngineError`](/reference/engine/type-aliases/engineerror/)\>
