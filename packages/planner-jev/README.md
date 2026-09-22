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

Set the variables below in the root `.env`, then run from the repo root:

```sh
npx nx dev-jev @maelstrom-co/demo
```

`dev-jev` is the demo's `dev` target with `MAELSTROM_PLANNER=jev` and server-key mode (`VITE_BROWSER_KEY_MODE=0`). Add `JEV_LOG_REPLIES=1` to see raw Jev replies.

| Variable | Meaning |
| --- | --- |
| `MAELSTROM_PLANNER` | `llm` (default) or `jev`. Anything else fails startup. |
| `TYPESAFE_API_KEY` | TypeSafe key. Required for `jev`; server-side only and redacted from logs. |
| `JEV_MODEL` | Pinned Jev model, for example `jev-1.13.0`. Required for `jev`; `jev-latest` drifts. |
| `OPENAI_API_KEY` | Server OpenAI key for `llmComplete` and the fallback. Required for `jev`. |
| `JEV_LOG_REPLIES` | `1` logs every raw Jev reply as `jev.reply`. Off by default; local debugging only. |

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
- `jev.reply` (debug, opt-in via `logReplies` / `JEV_LOG_REPLIES=1`): the state and questions sent (the user's words included) and the raw reply, as JSON, before validation, so an invalid reply is visible too.
- `jev.action_dropped` (info): an action dropped for a `not_stated` parameter.

## Evaluating

`eval/` holds a live runner that compares named planners (arms, registered in `eval/arms.ts`) on the same scenarios: the tiling scenarios of the Jev prototype, keep-versus-replace cases, parameter cases that separate `stated_elsewhere` from `not_stated`, explicit arrangement requests scored by arrangement rules (swap, big instance on the right, mixed row-and-split, edge strip, reorder, a 2x2 grid and more, tagged `spatial: true`) and non-spatial controls that should leave the arrangement alone (content edits, view changes, an added widget, tagged `spatial: false`). Any arm may satisfy an arrangement rule, the Jev arms' fallback included; the fallback columns show who did. Every arm runs through `createEngine` with history off and `retry: false`; the baseline is the same once-retried `llmPlanner` the Jev arms fall back to, so the arms differ only in their pipelines. Scores use the shipped (validated and healed) response.

```sh
OPENAI_API_KEY=... TYPESAFE_API_KEY=... JEV_MODEL=jev-1.13.0 \
  bunx nx run @maelstrom-co/planner-jev:eval -- --suite all --arm baseline --arm jev-poc --repeats 3
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--suite` | `all` | `development`, `holdout` or `all`. |
| `--arm` | `baseline`, `jev-poc` | A named arm from `eval/arms.ts`; repeat the flag for several. Columns follow the order given, and a repeated name runs once. `jev` is an alias of `jev-poc`. `jev-ungated-stepwise` composes the stage library in `src/lib/stages-experimental/`: ungated select, stepwise actions, the menu layout and the completion call. |
| `--repeats` | `3` | Runs per scenario and arm. |
| `--case` | every case | A scenario id; repeat the flag for several. |
| `--model` | the demo's default | OpenAI model for the baseline, `llmComplete` and the fallback. |
| `--out` | `tmp/planner-jev-eval/<timestamp>` | Output directory (`tmp` is gitignored). |
| `--verbose` | off | Logs the Engine and every Jev call to the console. |
| `--replay-from` | none | A previous run's output directory to replay upstream stages from. Needs `--replay-through`. |
| `--replay-through` | none | `select`, `actions` or `layout`: every Jev arm replays the stages up to and including this one from the recorded run, and runs the rest live. |
| `--replay-arm` | `jev-poc` | The arm of the recorded run whose stages are replayed. |

Without `OPENAI_API_KEY`, `TYPESAFE_API_KEY` or `JEV_MODEL` the runner writes `status.json` naming the missing variables and exits with code 2. Live runs are not part of `nx test`; the offline tests use a scripted TypeSafe transport and a mocked `chat()`.

Each Jev turn writes its stages' inputs and outputs to `<out>/stages/<arm>/<scenarioId>-<repeat>.json`. Replay reads them back: a replayed stage returns the recorded output (or the same deferral), so the stage after it runs on identical upstream results. Jev and LLM replies are not deterministic, so replay isolates one stage; it never stands in for an end-to-end result. A turn with no recorded stage fails with an error naming the stage and turn.

### Reading the report

`report.md` puts the arms side by side for each suite, one column per arm in the order given (`records.json` has every turn, `summary.json` the numbers and the run's settings, including `replay` when stages were replayed). `paired.md` lists every scenario and repeat where the arms disagree on pass, with each arm's failures.

- **Overall pass**: shipped responses with the expected visible and retained instances, the expected ordered actions and parameters, the scenario's arrangement rules, and no existing instance whose variant changed without an action. New instances match by Vessel and order, so the baseline's own ids score fairly. Scenarios where the POC is expected to defer are left out of every arm and reported as **Expected deferrals at the right stage** for the Jev arms.
- **Arrangement pass**: the shipped tree against the scenario's arrangement rules (`eval/predicates.ts`: order, left of, above, dominant share, full width or height, side by side, stacked, unchanged tree, area ratio), whichever arm or fallback wrote the tree. The denominator is every planned turn whose scenario declares rules; a turn that errored, shipped no response or shipped a non-tiling layout counts as a failure.
- **Decisive turns** (Jev arms): planned turns no stage deferred, their pass rate, and wins and losses against the baseline on the same scenario and repeat.
- **Selection / Actions / Layout accuracy** (Jev arms): each stage's own output against the expectation. Selection compares the visible and retained sets, actions compare the ordered actions, bound parameters and asks (a `stated_elsewhere` slot counts when the expectation has a value for it), layout compares the tree's leaves with the visible set and checks the arrangement rules.
- **Fallbacks** (Jev arms): the fallback rate, then one row per `<stage>/<code>` deferral reason.
- **llmComplete fill rate**: filled `stated_elsewhere` slots over all such slots; a `param_unfilled` deferral counts all of its turn's slots as unfilled.
- **Spatial gate**: filled once a Jev arm has a spatial gate; until then the row shows how many scenarios are tagged spatial and how many are non-spatial controls.
- **Latency**: p50 and p95 of the whole turn, each live stage (replayed stages show `replayed`), each Jev call and each LLM call by role.
- **Tokens**: Jev usage from its replies, in total and per turn, and OpenAI usage per role (`planner`, `fallback`, `complete`), recorded by wrapping the text adapter.

`records.json` also carries every Jev answer with its confidence (deferred stages included) and the lowest confidence among the answers the completed stages consumed. It is recorded, not enforced.
