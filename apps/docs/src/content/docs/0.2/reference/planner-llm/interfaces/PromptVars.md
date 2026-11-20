---
editUrl: false
next: false
prev: false
title: "PromptVars"
---

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:21

Variables interpolated into built-in system defaults before customization.

## Indexable

> \[`key`: `string`\]: `string` \| `undefined`

Extra variables available to built-in defaults; custom content is not interpolated.

## Properties

### assistantName?

> `readonly` `optional` **assistantName?**: `string`

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:23

Assistant name substituted into the identity section. Default: 'Maelstrom'
