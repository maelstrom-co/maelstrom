---
editUrl: false
next: false
prev: false
title: "createEngine"
---

> **createEngine**(`config`): [`Engine`](/reference/engine/interfaces/engine/)

Defined in: packages/engine/src/lib/engine.ts:248

Construct an Engine from the given config.

Every `chart_request` runs through `config.planner`, wrapped in
`withRetry(planner, config.retry)` unless `config.retry` is `false`. The
Engine loads history, hands the planner a [PlanningInput](/reference/engine/interfaces/planninginput/) and a
[StageContext](/reference/engine/interfaces/stagecontext/), then heals and validates the returned candidate
against the request the client sent, whatever the planner did to its own
copy of it. A planner never rejects `handle`: a thrown stage becomes an
`Err`, and a `Deferred` nothing recovered becomes
`Err(ValidationError)` on field `'planner'`.

Unlike `Engine.handle`, which surfaces runtime failures through
`Result<…, EngineError>`, this factory validates `config` synchronously
and **throws** on invalid input. Invalid config is a programmer error,
not a runtime condition — consumers outside TypeScript (or calling with
unknown input) should wrap in `try`/`catch`.

## Parameters

### config

[`EngineConfig`](/reference/engine/interfaces/engineconfig/)

## Returns

[`Engine`](/reference/engine/interfaces/engine/)

## Throws

If `config` fails Zod validation. The message is prefixed
  with `Invalid EngineConfig:` and the original error is attached as
  `cause`.

## Example

```ts
// `modelPlanner` is any `Planner`, for example one that calls a model.
const engine = createEngine({
  planner: modelPlanner,
  retry: { max: 2 },
});
```
