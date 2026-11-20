---
editUrl: false
next: false
prev: false
title: "EngineConfig"
---

Defined in: packages/engine/src/lib/config.ts:11

Dependencies and optional policies used to construct an Engine.

## Properties

### history?

> `readonly` `optional` **history?**: [`HistoryConfig`](/reference/engine/interfaces/historyconfig/)\<`unknown`\>

Defined in: packages/engine/src/lib/config.ts:37

Optional history configuration. When omitted, chart_request turns still
process normally but nothing is recorded, and assistant_message messages
produce a validationError ('history not configured') since they have
nowhere to be injected.

***

### instrument?

> `readonly` `optional` **instrument?**: [`Instrument`](/reference/engine/interfaces/instrument/)

Defined in: packages/engine/src/lib/config.ts:44

Optional telemetry seam (defaults to `noopInstrument`). Stages receive it
as `StageContext.instrument`; `pipeline` wraps every stage with
`instrument.stage` per request, and stages report model calls and other
events through `instrument.event`.

***

### logger?

> `readonly` `optional` **logger?**: [`Logger`](/reference/engine/interfaces/logger/)

Defined in: packages/engine/src/lib/config.ts:30

Optional logger (defaults to consoleLogger). Stages receive it as `StageContext.logger`.

***

### planner

> `readonly` **planner**: [`ClarifyingPlanner`](/reference/engine/type-aliases/clarifyingplanner/)

Defined in: packages/engine/src/lib/config.ts:21

Produces the candidate response for every `chart_request`. Use a
planner implementation as is, or compose stages with `pipeline` and
`withFallback`. The Engine heals and
validates whatever the planner returns against the request the client
sent. Validation accepts a needs-clarification result only for a request
that set `skipReply: true`, and `Engine.handle` currently refuses it even
then with `Err(ValidationError)` on field `skipReply`.

***

### retry?

> `readonly` `optional` **retry?**: `false` \| [`WithRetryOptions`](/reference/engine/interfaces/withretryoptions/)

Defined in: packages/engine/src/lib/config.ts:54

Retry policy the Engine wraps around [EngineConfig.planner](/reference/engine/interfaces/engineconfig/#planner) with
`withRetry`. `{ max }` re-runs the planner up to `max` times while
validation recommends a retry (`max` is a non-negative integer). `false`
(or `{ max: 0 }`) runs the planner once; the Engine still heals and
validates the candidate. Use `false` for planners that retry their own
steps. Default `{ max: 1 }`. See the README's Retry section for the full
policy.

***

### validatePlan?

> `readonly` `optional` **validatePlan?**: [`PlanValidator`](/reference/engine/type-aliases/planvalidator/)

Defined in: packages/engine/src/lib/config.ts:28

Optional synchronous check of application requirements on the healed response.
Issues use the configured retry budget. Unresolved issues return a
ValidationError on `validatePlan`, including when retries are disabled.
Without this hook, the existing healing and retry policy is unchanged.
