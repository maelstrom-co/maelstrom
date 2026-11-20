---
editUrl: false
next: false
prev: false
title: "LlmPlannerOptions"
---

Defined in: packages/planner-llm/src/lib/llm-planner.ts:42

Configuration for [llmPlanner](/reference/planner-llm/functions/llmplanner/).

## Properties

### adapter

> `readonly` **adapter**: `AnyTextAdapter`

Defined in: packages/planner-llm/src/lib/llm-planner.ts:44

TanStack AI text adapter (e.g. `geminiText('gemini-2.0-flash')`, `openaiText('gpt-4o')`).

***

### modelOptions?

> `readonly` `optional` **modelOptions?**: `Record`\<`string`, `unknown`\>

Defined in: packages/planner-llm/src/lib/llm-planner.ts:52

Provider-specific options forwarded verbatim to every `chat()` call
(e.g. `{ max_output_tokens: 16384 }` for an OpenAI adapter). Consult the
adapter's provider-options type for the accepted shape.

***

### prompt?

> `readonly` `optional` **prompt?**: [`PromptOptions`](/reference/planner-llm/interfaces/promptoptions/)

Defined in: packages/planner-llm/src/lib/llm-planner.ts:46

Section-based customization of the system and user prompts.
