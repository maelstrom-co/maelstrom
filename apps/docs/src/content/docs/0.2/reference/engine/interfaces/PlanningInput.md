---
editUrl: false
next: false
prev: false
title: "PlanningInput"
---

Defined in: packages/engine/src/lib/planner/stage.ts:31

What the Engine hands the first stage of a [Planner](/reference/engine/type-aliases/planner/) for one
`chart_request`. Stages may pass a modified copy downstream (for example a
narrowed `request`), but the Engine always validates the final candidate
against the request it received, which stays available as
[StageContext.origin](/reference/engine/interfaces/stagecontext/#origin).

## Properties

### history

> `readonly` **history**: readonly [`LLMContextMessage`](/reference/engine/interfaces/llmcontextmessage/)[]

Defined in: packages/engine/src/lib/planner/stage.ts:39

Prior conversation as projected by the Engine's history config. Empty without history.

***

### messageId

> `readonly` **messageId**: `MessageId`

Defined in: packages/engine/src/lib/planner/stage.ts:33

Envelope id of the `chart_request`, for correlating stage logs with Engine logs.

***

### request

> `readonly` **request**: `ChartRequest`

Defined in: packages/engine/src/lib/planner/stage.ts:37

Chart state, Vessel catalog and update reasons as the client sent them.

***

### sessionId

> `readonly` **sessionId**: `SessionId`

Defined in: packages/engine/src/lib/planner/stage.ts:35

Session the request belongs to; the key for any per-session state a stage keeps.
