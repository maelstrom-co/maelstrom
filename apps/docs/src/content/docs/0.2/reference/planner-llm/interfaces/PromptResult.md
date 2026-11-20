---
editUrl: false
next: false
prev: false
title: "PromptResult"
---

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:39

Fully joined prompts together with their post-customization sections.

## Properties

### sections

> `readonly` **sections**: `object`

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:45

Post-interpolation and post-override sections used to build each prompt.

#### system

> `readonly` **system**: readonly [`PromptSection`](/reference/planner-llm/interfaces/promptsection/)[]

Join order for `systemPrompt`, including empty sections omitted from the string.

#### user

> `readonly` **user**: readonly [`PromptSection`](/reference/planner-llm/interfaces/promptsection/)[]

Join order for `userPrompt`, including empty sections omitted from the string.

***

### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:41

System sections joined with blank lines.

***

### userPrompt

> `readonly` **userPrompt**: `string`

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:43

User sections joined with blank lines.
