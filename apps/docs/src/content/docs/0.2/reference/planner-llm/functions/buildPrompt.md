---
editUrl: false
next: false
prev: false
title: "buildPrompt"
---

> **buildPrompt**(`request`, `options?`, `logger?`): [`PromptResult`](/reference/planner-llm/interfaces/promptresult/)

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:74

Build the full prompt (system + user halves) for a chart request.

Thin composition over [buildSystemPrompt](/reference/planner-llm/functions/buildsystemprompt/) and [buildUserPrompt](/reference/planner-llm/functions/builduserprompt/).
The returned `sections` array exposes the post-override section list, useful
for telemetry or diffing customizer effects.

## Parameters

### request

`ChartRequest`

### options?

[`PromptOptions`](/reference/planner-llm/interfaces/promptoptions/)

### logger?

`Logger`

## Returns

[`PromptResult`](/reference/planner-llm/interfaces/promptresult/)

## Throws

If a section customizer is invalid (function targeting a
  non-default key) or itself throws. Messages have the form
  `Prompt section customizer for "<key>" ...` so consumers can extract the
  failing section key from the quoted prefix.

## Example

```ts
const { systemPrompt, userPrompt } = buildPrompt(request, {
  vars: { assistantName: 'Aria' },
  system: { rules: (defaults) => `${defaults}\n\nAlways respond in Spanish.` },
  user: { vessels: 'Custom vessel definitions here.' },
});
```
