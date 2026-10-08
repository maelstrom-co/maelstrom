# TanStack AI 0.65.1 upgrade review

This reference records migration requirements and setup recommendations for
Maelstrom's TanStack AI integration. It covers the planners, evaluation adapter,
and demo factories. It does not change provider or model selections.

## Package scope

Registry metadata checked on October 7, 2026 confirms these releases:

| Package | Previous lockfile version | Updated version |
| --- | --- | --- |
| `@tanstack/ai` | `0.43.1` | `0.65.1` |
| `@tanstack/ai-openai` | `0.18.0` | `0.27.0` |
| `@tanstack/ai-gemini` | `0.21.0` | `0.36.0` |

The packages must move together. OpenAI requires core `^0.65.0`; Gemini
requires core `^0.65.1`. The [root catalog](../../package.json) owns these ranges.
The lockfile also updates their transitive TanStack packages and AG-UI to `1.0.0`.
Sources: [core registry metadata][registry-ai], [OpenAI manifest][openai-package],
and [Gemini manifest][gemini-package].

Official guides were retrieved through Context7. Released npm source and
declarations were checked separately because examples and skill version headers
can lag the release. External source links pin the core `0.65.1` release commit,
which also contains OpenAI `0.27.0` and Gemini `0.36.0`.

## Applied migration and improvements

### Normalize AG-UI token usage

`RUN_FINISHED.usage` now accepts either the legacy TanStack `TokenUsage` object
or an AG-UI usage array. Direct assignment no longer type-checks.

The [evaluation adapter](../../packages/evals/src/core/usage-adapter.ts) preserves
the object branch and sums each reported array counter independently.
`fromSpecTokenUsage()` fills absent counters with zero, so it cannot preserve
measurement presence. An empty array or label-only entries mean usage is missing.
Partial records keep known counts and omit unknown ones, including total tokens.
Totals are not derived from other counters. Explicit zero counts remain zero.
Evaluation summaries sum reported counts and mark calls missing input or output
usage with `withoutUsage`. These sums can be incomplete.
Regression tests cover both formats, multiple entries, partial counters, and
missing usage. Stream chunks remain unchanged.
Sources: [event types][types] and [normalizer][usage].

### Keep provider errors on the engine logger

TanStack enables its `errors` debug category by default and uses its own
`ConsoleLogger`. That path bypasses the hosted demo's redacting engine logger.
This was an existing integration gap, not a new upgrade regression.

All planner `chat()` calls now set `debug: false`. Existing engine error
reporting remains enabled. An isolated runtime regression uses the real TanStack
implementation and a fake provider error to verify console silence across the
LLM planner, Jev completion, and inline layout completion.

A custom TanStack logger remains an option. However, a `DebugConfig` object
enables every unspecified category, including provider and output data.
Passing only `{ logger }` is therefore unsafe for hosted mode.
Sources: [debug guide][debug-guide], [debug defaults][debug-source], and the
[Worker factory](../../apps/demo/src/worker/session/engine-factory.ts).

### Stop unused LLM planner requests

The [LLM planner call](../../packages/planner-llm/src/lib/call-llm.ts) previously
combined signals only for its initial cancellation check. It passed a separate
controller to `chat()`, leaving later caller aborts disconnected from the provider.

The call now forwards cancellation to that controller and removes the listener
after settlement. It also rejects a late response when the caller has cancelled,
even if the provider ignores the abort. Regression tests cover both cases.
Jev already forwards caller cancellation.

Gemini `0.29.3` fixed SDK signal forwarding; `0.30.0` added native
structured-output streaming. These changes are included in the updated adapter.
Sources: [Gemini changelog][gemini-changelog] and
[Jev completion](../../packages/planner-jev/src/lib/stages/llm-complete.ts).

### Preserve the output budget

Core `0.61.0` added explicit `max_tokens` errors for native combined structured
output when the adapter reports `finishReason: 'length'`. OpenAI Responses instead
emits `RUN_ERROR` with code `incomplete` and message `max_output_tokens` for a
`response.incomplete` budget cutoff. Both paths reject the incomplete result.
The Worker comment avoids promising one error code. The `16384` output cap stays
unchanged because OpenAI shares it between reasoning and visible output.
Sources: [core changelog][changelog], [structured-output finalization][chat-source],
and [OpenAI Responses terminal handling][responses-source].

### Report model usage through the engine

The existing `StageContext.instrument` seam answers three operational questions:
which model consumes tokens, whether calls fail or get cancelled, and how long
calls take. No new public middleware option is needed.

The [LLM planner](../../packages/planner-llm/src/lib/llm-planner.ts) and
[Jev completion helper](../../packages/planner-jev/src/lib/llm-call.ts) collect
reported counters from `RUN_FINISHED` in `onChunk`. They emit one `llm.call` event
after the call settles:

| Attribute | Meaning |
| --- | --- |
| `gen_ai.request.model` | Adapter model |
| `gen_ai.usage.input_tokens` | Sum of reported input tokens; absent without usage |
| `gen_ai.usage.output_tokens` | Sum of reported output tokens; absent without usage |
| `maelstrom.outcome` | `ok`, `error`, or `cancelled` at the call boundary |
| `maelstrom.latency_ms` | Call duration in milliseconds |
| `maelstrom.message_id` | Origin request correlation |
| `maelstrom.session_id` | Origin session correlation |

Outcome comes from the planner result rather than a TanStack terminal hook. A
provider can finish after caller cancellation; that response must still be
rejected. Later candidate validation or Jev deferral has its own stage outcome.
An already-cancelled request reports cancellation without contacting a provider.

Usage survives finalization failure when the provider already reported it.
Unknown usage stays absent rather than becoming zero. `onFinish.info.usage` is
not added: it repeats agent-loop usage and omits separate finalization usage.
Collectors belong to individual calls, so concurrent requests cannot share totals.
The raw chunks retain counter presence that `onUsage` normalization discards.
Partial usage emits only known input or output attributes. The collectors do not
add normalized hook totals to raw chunk totals. Real-runtime regressions cover
66 combinations across the three planner entry paths and finalization modes.

OpenAI's `response.incomplete` path does not forward terminal usage, even when
the upstream event contains it. An offline replay with the real adapter confirms
this limit. Instrumentation cannot recover usage the adapter discards.

Events exclude prompts, output, provider errors, and credentials. Use correlation
IDs in logs or traces, not metric labels. The caller supplies the instrument;
the engine's default remains a no-op.

Evaluation accounting stays in the role-labelled adapter proxy. Reports do not
add instrument totals to proxy totals. Offline integration tests exercise native
combined output, streaming finalization, and direct finalization through all
three planner call paths. They verify known and unknown usage, invalid output,
and unchanged evaluation totals. Source: [middleware guide][middleware-guide].

### Use the built-in OpenAI model catalog

The [demo model factory](../../apps/demo/src/server/engine-model.ts) now calls
`createOpenaiChat()` directly. OpenAI `0.27.0` includes `gpt-6-luna`, so the custom
`createModel()` and `extendAdapter()` wrapper is redundant. The default remains
`gpt-6-luna`; the trimmed `ENGINE_MODEL` override and explicit caller API keys
remain unchanged. Blank overrides still use the default. Regression tests cover
these cases and confirm caller keys do not come from the server environment.
Catalog membership does not prove account access. Sources: [model catalog][models]
and [OpenAI factory][openai-source].

## Existing setup to retain

- `chat({ outputSchema, stream: false, abortController, modelOptions })` remains
  supported, as do `createOpenaiChat(model, apiKey)`, `createModel()`, and
  `extendAdapter()`. Explicit key injection remains appropriate for BYOK.
  Sources: [chat implementation][chat-source], [OpenAI factory][openai-source],
  and [adapter extension][extend-source].
- Awaited structured output validates Standard Schema values inside the engine.
  Streaming structured output defers validation to the consumer. Keep the current
  non-streaming planner boundary. Plain JSON Schema has no runtime validator.
  Optional fields widened to nullable values are normalized before validation;
  genuinely nullable fields retain `null`. Schema inference still uses the input
  type, so the branded-output cast remains necessary.
  Sources: [structured-output guide][structured-guide] and [inference types][types].
- Core `0.65.0` adds the `activity` UI-message role; `0.65.1` requires `data` on
  completed structured-output parts. The planners return objects rather than
  TanStack UI messages, so those migrations do not apply. Concurrent server tools
  also do not affect these calls, which provide no TanStack tools. Maelstrom
  executes actions through its own engine. Source: [changelog][changelog].

## Verification scope

The approved live smoke batch made eight requests. Two additional OpenAI
diagnostic requests repeated the failed checks with redacted error capture.
One final OpenAI request verified cancellation when response headers arrived.
The live checks made eleven requests in total.
Each case allowed one provider request, no network retries, and a 45-second
timeout. Output caps were 512 tokens for schema checks, 128 for validation,
16 for budget exhaustion, and 256 for cancellation. Inputs were synthetic.
Credentials stayed in the child process environment and were not recorded.

| Check | OpenAI `gpt-6-luna` | Gemini `gemini-3.1-flash-lite-preview` |
| --- | --- | --- |
| Transformed identifier, optional and nullable fields | Passed | Passed |
| Intentional local schema refinement rejection | Passed | Passed |
| Output-budget exhaustion | Rejected; `incomplete`, message `max_output_tokens` | Passed; `max_tokens` |
| Caller cancellation after first text | Not exercised; budget exhausted before text | Passed; transport aborted |
| Caller cancellation on response headers | Passed; transport aborted before text | Not run |

The first batch passed six of eight original assertions. The OpenAI budget
assertion expected `max_tokens`, but both attempts returned `incomplete` with
message `max_output_tokens`. The cancellation fixture failed before its abort
trigger. Neither failure returned an incomplete object as a successful result.
The two diagnostic requests confirmed the same outcomes. They did not verify
live OpenAI cancellation.

The final OpenAI check cancelled immediately after HTTP `200` headers arrived,
before the SDK consumed the response body. The provider's transport signal was
aborted synchronously. `chat()` rejected 27 milliseconds after cancellation and
fired only `onAbort`, with no text or usage callback. The request took 1948
milliseconds in total. This verifies local transport cancellation, not when the
provider stops generation or billing.

A network-disabled SSE replay through the real OpenAI SDK and TanStack adapter
confirmed three behaviors: `response.incomplete` rejects with `incomplete` and
omits usage; `response.completed` with a length cutoff reaches core `max_tokens`
handling and forwards usage; caller cancellation after a text delta aborts the
transport and fires `onAbort`. These are synthetic event fixtures, not captured
provider bodies. They verify adapter behavior, not live model behavior.

Four live responses reported 158 input and 74 output tokens. The budget and
cancellation cases reported no usage through TanStack, so 232 reported tokens
are not a complete billing total. No exact monetary cost was calculated.

Offline integration tests also verify schema transforms, combined structured
output, AG-UI usage capture, and planner telemetry. Live checks used small schemas,
not full planner layouts or actions. They do not establish planner quality.

## Remaining verification

- Malformed provider JSON was not tested live. Local schema refinement rejection
  verifies validation, not malformed JSON parsing.
- OpenAI terminal usage loss remains an upstream adapter limit. Keep missing
  usage absent; do not estimate it from the request's output cap.

[registry-ai]: https://registry.npmjs.org/@tanstack/ai/0.65.1
[openai-package]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/ai-openai/package.json
[gemini-package]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/ai-gemini/package.json
[changelog]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/ai/CHANGELOG.md
[gemini-changelog]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/ai-gemini/CHANGELOG.md
[types]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/ai/src/types.ts
[usage]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/ai/src/utilities/ag-ui-usage.ts
[chat-source]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/ai/src/activities/chat/index.ts
[openai-source]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/ai-openai/src/adapters/text.ts
[responses-source]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/openai-base/src/adapters/responses-text.ts
[extend-source]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/ai/src/extend-adapter.ts
[debug-guide]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/docs/advanced/debug-logging.md
[debug-source]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/ai/src/logger/resolve.ts
[structured-guide]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/docs/structured-outputs/overview.md
[middleware-guide]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/docs/advanced/middleware.md
[models]: https://github.com/TanStack/ai/blob/25e0d65e19eee4641eece3cc812b9ba991d62893/packages/ai-openai/src/model-meta.ts
