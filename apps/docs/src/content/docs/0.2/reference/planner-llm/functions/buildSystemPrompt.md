---
editUrl: false
next: false
prev: false
title: "buildSystemPrompt"
---

> **buildSystemPrompt**(`mode`, `options?`): `string`

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:112

Build the system-prompt half for a given layout mode and config-time options.

Pure: depends only on its arguments, so the result can be cached per
`(mode, options)` tuple. `llmPlanner` precomputes one string per
`LayoutMode` at construction and indexes by `request.context.layoutMode` per
request — derive once, not per-turn.

## Parameters

### mode

`LayoutMode`

### options?

`Pick`\<[`PromptOptions`](/reference/planner-llm/interfaces/promptoptions/), `"system"` \| `"vars"`\>

## Returns

`string`

## Throws

If a `system` customizer is invalid (function targeting a
  non-default key) or itself throws. Messages have the form
  `Prompt section customizer for "<key>" ...`.

## Example

```ts
const systemPrompt = buildSystemPrompt('grid', {
  vars: { assistantName: 'Aria' },
  system: { identity: 'You are a healthcare assistant.' },
});
```
