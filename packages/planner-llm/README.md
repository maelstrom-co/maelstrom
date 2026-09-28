# @maelstrom-co/planner-llm

[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

📚 **Full documentation:** <https://docs.maelstrom-ai.co/reference/planner-llm/readme/>

The reference LLM planner for the Maelstrom engine's planner seam. `llmPlanner(options)` returns a `Stage<LlmPlannerInput, PlannerCandidate>` that asks one LLM for the whole candidate in a single structured-output `chat()` call per attempt, using a TanStack AI adapter. The package also exports the section-based prompt builder the planner uses.

---

## Quickstart

```ts
import { geminiText } from '@tanstack/ai-gemini';
import {
  ChartRequestMessage,
  SessionId,
  isOk,
} from '@maelstrom-co/protocol';
import { createEngine } from '@maelstrom-co/engine';
import { llmPlanner } from '@maelstrom-co/planner-llm';

const engine = createEngine({
  planner: llmPlanner({ adapter: geminiText('gemini-2.0-flash') }),
});

const session = SessionId();

const message = ChartRequestMessage({
  sessionId: session,
  request: /* build ChartRequest */,
});

const result = await engine.handle(message);

if (isOk(result) && result.value.type === 'chart_response') {
  // result.value.response is the MaelstromResponse
  console.log(result.value.response.userMessage);
}
```

---

## Options

```ts
interface LlmPlannerOptions {
  /** TanStack AI text adapter. Required. */
  adapter: AnyTextAdapter;
  /** Section-based prompt customization. */
  prompt?: PromptOptions;
  /** Provider-specific options forwarded verbatim to every `chat()` call. */
  modelOptions?: Record<string, unknown>;
}
```

```ts
import { geminiText } from '@tanstack/ai-gemini';
import { llmPlanner } from '@maelstrom-co/planner-llm';

const planner = llmPlanner({ adapter: geminiText('gemini-2.0-flash') });
```

`adapter` accepts any TanStack AI text adapter: Gemini, OpenAI, Anthropic, or a custom adapter implementing the same interface. `modelOptions` is forwarded verbatim to every `chat()` call, so provider-specific settings (temperature, safety settings, tool config) pass straight through.

`llmPlanner(...)` validates its options and builds the system prompts once at construction. A bad option, or a misconfigured system-prompt customizer, throws synchronously with `Invalid LlmPlannerOptions: ...` rather than surfacing later on the first request.

---

## Prompt customization

`prompt` is section-based. `SystemSection` and `UserSection` enumerate the keys available on each side of the prompt. Each section accepts:

- a string, to replace the default content outright,
- `null`, to remove the section,
- a function `(defaultContent) => string`, to transform the default content, or
- `{ prepend?, append? }`, to add text around the default content.

`vars` substitutes `{{name}}` placeholders in the prompt text (e.g. `assistantName`).

See the [system prompt guide](https://docs.maelstrom-ai.co/guides/engine/system-prompt/) for a full walkthrough of section keys and customization patterns.

`buildPrompt`, `buildSystemPrompt`, and `buildUserPrompt` are exported for inspecting the exact prompt text a given configuration produces, useful for tests and dry runs.

---

## Retry prompt

The engine's `withRetry` re-runs the planner with the previous attempt's diagnostics when healing recommends a retry. On that re-run, `llmPlanner` sends the original user prompt preceded by a structured feedback block summarizing what went wrong; the system prompt is unchanged.

```
The previous response had issues. Please re-issue the response addressing:

Layout drops:
- instance "calendar-main" at (0,10) size 4x3 exceeds chart bounds (12x8)

Skipped actions:
- Action "expand" on instance "panel-2" had unparseable params: {bad

Original request:
<original user prompt>
```

---

## Composing

`llmPlanner` is one `Stage`, so it composes with the engine's stage combinators like any other. A common pattern is to try a cheaper or narrower planner first and fall back to `llmPlanner` when that planner defers:

```ts
import { pipeline, withFallback } from '@maelstrom-co/engine';
import { llmPlanner } from '@maelstrom-co/planner-llm';

const planner = withFallback(
  pipeline(selectVessels, arrangeLayout),
  llmPlanner({ adapter }),
);
```

See the engine README's [Planners and stages](https://github.com/maelstrom-co/maelstrom/blob/main/packages/engine/README.md#planners-and-stages) section for the full combinator set.
