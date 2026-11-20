---
editUrl: false
next: false
prev: false
title: "llmPlanner"
---

> **llmPlanner**(`options`): `Stage`\<[`LlmPlannerInput`](/reference/planner-llm/type-aliases/llmplannerinput/), `PlannerCandidate`\>

Defined in: packages/planner-llm/src/lib/llm-planner.ts:113

A planner that asks one LLM for the whole candidate in a single `chat()`
call: the system prompt for the request's layout mode, the user prompt
serialized from the request (plus any `hints`), prior history, and the
layout mode's structured output schema.

On a retry from the engine's `withRetry` the user prompt becomes the original
prompt preceded by the previous attempt's diagnostics; the system prompt is
unchanged. The original prompt is reused rather than rebuilt, so prompt
customizers and serializer warnings run once per request.

When the input's Vessel catalog is the one in `ctx.origin`, the prompt
reuses `ctx.enumSnapshot`, so the enum literals the model sees are exactly
those validation accepts. Any other catalog gets a fresh snapshot.

Returns `Err(ValidationError)` on field `'prompt'` when the user prompt
cannot be built, and the `callLLM` errors (`ProviderError`,
`CancellationError`) when the call fails; each is logged. The candidate is
returned unvalidated.

Each model call is reported to `ctx.instrument` as an `llm.call` event
with `gen_ai.request.model` (the adapter's model), `maelstrom.outcome`
(`ok`, `error` or `cancelled`), `maelstrom.latency_ms`, and the origin's
`maelstrom.message_id` and `maelstrom.session_id`. Adapter-reported usage
is summed across model calls as `gen_ai.usage.input_tokens` and
`gen_ai.usage.output_tokens`. Cache reads and writes use
`gen_ai.usage.cache_read.input_tokens` and
`gen_ai.usage.cache_creation.input_tokens`; provider-reported monetary cost
uses `gen_ai.usage.cost`, without price estimates or currency conversion.
Cache counters do not change input-token totals. Missing usage remains absent.
Prompts, output, provider errors, and credentials never appear in these events. Counters
normalized or omitted by an adapter cannot be recovered here.

## Parameters

### options

[`LlmPlannerOptions`](/reference/planner-llm/interfaces/llmplanneroptions/)

## Returns

`Stage`\<[`LlmPlannerInput`](/reference/planner-llm/type-aliases/llmplannerinput/), `PlannerCandidate`\>

## Throws

If `options` is invalid or a system-prompt customizer is
  misconfigured. System prompts are built once here, so the error surfaces
  at construction. The message starts with `Invalid LlmPlannerOptions:`
  and the original error is attached as `cause`.

## Example

```ts
const planner = llmPlanner({ adapter: openaiText('gpt-4o') });
```
