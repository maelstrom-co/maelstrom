---
editUrl: false
next: false
prev: false
title: "PromptOptions"
---

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:29

Section-level customization for the planner's system and user prompts.

## Properties

### system?

> `readonly` `optional` **system?**: `Readonly`\<[`SystemSectionOverrides`](/reference/planner-llm/type-aliases/systemsectionoverrides/)\>

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:33

System prompt section customizations. See SystemSection for available keys.

***

### user?

> `readonly` `optional` **user?**: `Readonly`\<[`UserSectionOverrides`](/reference/planner-llm/type-aliases/usersectionoverrides/)\>

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:35

User prompt section customizations. See UserSection for available keys.

***

### vars?

> `readonly` `optional` **vars?**: [`PromptVars`](/reference/planner-llm/interfaces/promptvars/)

Defined in: packages/planner-llm/src/lib/prompt/prompt-builder.ts:31

Variables substituted into built-in defaults before overrides are applied.
