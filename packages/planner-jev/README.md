# @maelstrom-co/planner-jev

Experimental, server-only Maelstrom planner built on TypeSafe's Jev model. Jev answers typed multiple-choice questions quickly and cheaply but writes no text, so this planner hands it the multiple-choice-shaped decisions and keeps one small LLM call for the reply.

The package is demo-only. It serves the local demo (`MAELSTROM_PLANNER=jev`) and the comparison eval. The hosted demo keeps the plain `llmPlanner`.

## What it does

`jevPlanner(options)` returns a `Planner` for `createEngine`:

```
withFallback(
  pipeline(jevSelect, jevActions, jevLayout, llmComplete),
  withRetry(fallback, { max: 1 }),
)
```

1. `jevSelect` asks one Jev call whether the request is supported, what happens to each existing instance (keep, hide or delete; `keep` on a hidden instance shows it) and which new instances to create, in which starting variant. Existing variants never change here.
2. `jevActions` plans the ordered actions, one Jev call per step, offering every legal action (view transitions included) at the variant earlier steps leave each instance in. After each action with parameters, one call binds them: an extracted candidate, `omit` for an optional parameter, `stated_elsewhere` (the LLM fills it) or `not_stated` (the action is dropped and the reply asks the user for the value).
3. `jevLayout` computes the tiling candidates that fit the Chart with every visible instance sized for its variant after the actions, and asks Jev to pick one.
4. `llmComplete` makes one small `chat()` call that writes `userMessage`, fills the `stated_elsewhere` values and asks for the `not_stated` ones. Code builds the layout (declaring each instance in its current variant; transition actions flip it afterwards), the execution plan and the rationale. The candidate then goes through `ctx.validate`: a validation error or a recommended retry defers instead of shipping a healed Jev plan.

Any deferral re-plans the whole request with `fallback`.

```ts
import { createEngine, llmPlanner } from '@maelstrom-co/engine';
import { jevPlanner } from '@maelstrom-co/planner-jev';

const engine = createEngine({
  planner: jevPlanner({
    typesafe: { apiKey: process.env.TYPESAFE_API_KEY, model: 'jev-1.13.0' },
    adapter,
    fallback: llmPlanner({ adapter }),
  }),
  retry: false,
});
```

### Retry placement

Run the Engine with `retry: false`. The Jev pipeline is never re-run whole: `llmComplete` validates its own candidate and defers instead. Retry lives on the fallback only, and the planner wraps `fallback` in `withRetry(fallback, { max: 1 })` itself, so pass it unwrapped.

## Environment (demo)

| Variable | Meaning |
| --- | --- |
| `MAELSTROM_PLANNER` | `llm` (default) or `jev`. Anything else fails startup. |
| `TYPESAFE_API_KEY` | TypeSafe key. Required for `jev`; server-side only and redacted from logs. |
| `JEV_MODEL` | Pinned Jev model, for example `jev-1.13.0`. Required for `jev`; `jev-latest` drifts. |
| `OPENAI_API_KEY` | Server OpenAI key for `llmComplete` and the fallback. Required for `jev`. |

## Limits

- Tiling only. Grid-mode requests defer to the fallback before any Jev call.
- At most 4 actions per request; a fifth defers.
- At most 255 options per question; a larger question defers before it is sent.
- A string parameter can only be bound to one of its enum values, a quoted string in the request, or a 1 to 8 word span of the request (requests over 32 words offer no spans). Numbers come from the request, booleans are `true`/`false`, objects have no candidates. Anything else is `stated_elsewhere`, which the LLM fills.
- Confidence is logged for every answer but not gated: Jev's confidence is uncalibrated.

## Deferral reasons

Every deferral logs `jev.defer` at info with `{ stage, reason, question }`, and the Engine's `Planner stage deferred, running fallback` line carries the same reason.

| Reason | Meaning |
| --- | --- |
| `jevSelect/grid_mode` | The request is in grid mode. |
| `jevSelect/scope_unsupported` | Jev judged the request unsupported. |
| `jevSelect/scope_ambiguous` | Jev judged the request ambiguous. |
| `jevActions/action_unsupported` | A requested action is not available. |
| `jevActions/action_limit` | Jev chose a fifth action. |
| `jevActions/simulation_failed`, `jevLayout/simulation_failed` | A planned action is not valid for its instance's simulated variant. |
| `jevLayout/no_feasible_layout` | No candidate layout fits the Chart and the minimum sizes. |
| `jevLayout/layout_unavailable` | Jev judged an explicit spatial request impossible with the candidates. |
| `llmComplete/param_unfilled` | The LLM returned `null` or an unparsable value for a `stated_elsewhere` parameter. |
| `llmComplete/invalid_candidate` | Validation rejected the assembled candidate. |
| `llmComplete/retry_recommended` | Validation recommended a retry for the assembled candidate. |
| `<stage>/option_cap` | A question had more than 255 options. |
| `<stage>/provider_timeout` | A TypeSafe call took longer than its timeout (5 s by default). |
| `<stage>/provider_network` | A TypeSafe call failed to connect. |
| `<stage>/provider_http` | TypeSafe answered with a non-2xx status. |
| `<stage>/provider_invalid_reply` | The reply was too large, not JSON, or failed strict validation. |
| `<stage>/low_confidence`, `<stage>/answer_missing` | Only with a confidence gate, or a reply missing a validated answer. |

`provider_*` deferrals also log `jev.provider_failure` at warn. A user cancellation is a `CancellationError`, and a provider failure inside `llmComplete` is a `ProviderError`; neither falls back, because the fallback would hit the same provider.

## Logs

- `jev.call` (debug): stage, model, question ids, latency, outcome and token usage of every TypeSafe call.
- `jev.answer` (debug): stage, question, choice and confidence of every answer read.
- `jev.action_dropped` (info): an action dropped for a `not_stated` parameter.
