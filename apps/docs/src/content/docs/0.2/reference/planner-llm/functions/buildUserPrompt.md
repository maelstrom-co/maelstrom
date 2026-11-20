---
editUrl: false
next: false
prev: false
title: "buildUserPrompt"
---

> **buildUserPrompt**(`request`, `options?`, `logger?`): `string`

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:144

Build the user-prompt half from a chart request.

Per-call work — depends on the request's vessels, instances, layout, and
update reasons, so the result can't be precomputed.

This standalone API constructs its own enum snapshot. `llmPlanner` instead
reuses the enum snapshot the Engine captured for the request
(`StageContext.enumSnapshot`), so prompt literals and validation share the
exact candidates.

## Parameters

### request

`ChartRequest`

### options?

`Pick`\<[`PromptOptions`](/reference/planner-llm/interfaces/promptoptions/), `"user"`\>

### logger?

`Logger`

## Returns

`string`

## Throws

If Action parameter definitions are ambiguous or exceed the
  enum-candidate ceiling, or if a `user` customizer is invalid (function
  targeting a non-default key) or itself throws. Customizer messages have the
  form `Prompt section customizer for "<key>" ...`. Callers operating inside
  a `Promise<Result>` contract should wrap in try/catch and convert to a
  Result error rather than letting the throw escape.

## Example

```ts
const userPrompt = buildUserPrompt(request, {
  user: { vessels: (defaults) => `${defaults}\n\nDomain note: …` },
});
```
