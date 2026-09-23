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

## Stage library (experimental)

`src/lib/stages-experimental/` holds candidate stages measured against the frozen POC, and `src/lib/planners/` composes them into named planners with `pipeline(...)`, each wrapped in the same fallback. None is exported yet; the eval runs them as arms. Every stage keeps the POC's stage names (`jevSelect`, `jevActions`, `jevLayout`, `llmComplete`), so deferral reasons, the report and replay treat them alike.

| Stage | Replaces | What it does |
| --- | --- | --- |
| `selectUngated` | `jevSelect` | The POC's selection, unchanged. |
| `selectGated` | `jevSelect` | The POC's selection plus three yes/no (`noul`) questions in the same call: `needsActions` (the intent asks for a view change or a content edit, not only showing, hiding, removing or arranging), `generatedContent` (the intent asks for content that must be invented or fetched) and `spatial` (the intent states where something goes or how large it is). A gate answers yes at a probability of 0.5 or more; every probability is kept on the selection's `gates`. A generated-content yes defers `jevSelect/scope_unsupported`. `spatial` is recorded for later layout stages. |
| `actionsStepwise` | `jevActions` | The POC's actions, one call per step plus one per parameterised action. |
| `actionsStepwiseGated` | `jevActions` | `actionsStepwise` behind the `needsActions` gate: a gated selection answering no plans no actions and makes no call, anything else runs the stepwise stage unchanged. |
| `actionsBatched` | `jevActions` | State-keyed batching, two calls. The first asks, for every variant state the request can reach by transitions, which action comes next at each depth up to the action limit (`action/0`, then `action/<depth>@<state>`, the state named by the instances whose view changed, `same` when none did). Questions are keyed by state, not by the actions that led there, so two orders reaching the same views share a question. Code walks the answers from the current views. Past `MAX_BATCH_QUESTIONS` (48) whole depths are left out and asked one call per step. The second call binds every chosen action's parameters at once, with the same parameter questions as the stepwise stage. |
| `actionsBatchedPerInstance` | `jevActions` | Per-instance batching, one call: for each instance, slot 1 (its first action, `none` or `unsupported`), slot 2 (its second action, each option labelled with the view slot 1 leaves it in, for example `week:addEvent`) and slot 3 (never planned: an answer naming an action defers `jevActions/action_limit`, the rest is measurement), plus the parameters of every action any slot could pick. Code takes slot 2 only when its label matches the view slot 1's answer leads to; any other label defers `jevActions/premise_mismatch`. Parameter answers off the walked path are discarded. |
| `layoutPreset` | `jevLayout` | The POC's choice over precomputed layouts. Never hands off. With `describe: 'placements'` each layout is described by its Instances and positions ("Stacked: calendar-main and weather-main side by side on top, tasks-main full width below.") instead of by its split tokens, and layouts placing every Instance on the same rectangles are offered once; the default keeps the POC's wording and call. |
| `layoutPresetOrLlm` | `jevLayout` | Experimental. One Jev call with the placements menu and two yes/no questions: `needsChange` (the request states an arrangement different from the current one) and `needsBetter` (no offered layout is that arrangement). No change keeps the current tree when it fits, else the balanced default; needing better hands the layout off; otherwise the chosen layout ships. |
| `layoutSpatialGate` | `jevLayout` | Experimental. No layout call: reads the `spatial` gate of `selectGated`. A stated arrangement hands the layout off; otherwise it keeps the current tree when it fits, else the balanced default. Its input type requires the gates, so a planner with `selectUngated` does not compile. |
| `layoutComposed` | `jevLayout` | Experimental. Composes the tree from Jev's answers about its parts in one call (see below). Reads the `spatial` gate like `layoutSpatialGate` and requires it the same way. |
| `layoutAlwaysLlm` | `jevLayout` | Experimental. No Jev call; always hands the layout off. The control for the other layout stages. |
| `completeLayoutInline` | `llmComplete` | The POC's completion call; when a layout stage hands the layout off, the LLM also writes the tree. |
| `completeLayoutParallel` | `llmComplete` | Experimental. On a hand-off, runs the message-only completion call and a small tree-only layout call in parallel; a failure in either aborts the other. With a tree from the layout stage it is the same single call as `completeLayoutInline`. |

The balanced default, shared by the layout stages that keep or default, is the first that fits of one side-by-side row, two stacked rows and three stacked rows (the `row`, `rows_2` and `rows_3` layouts of the preset menu); a lone Instance fills the Chart. When none fits, the layout is handed off.

Both batched stages and `actionsStepwiseGated` skip their call when a gated selection's `needsActions` answers no, and plan no actions on a resize-only turn. Both batched stages check the planned actions against the simulated views and defer `jevActions/simulation_failed` when a dropped action leaves a later one invalid.

The per-instance stage trades against the state-keyed one:

- One call instead of two, at the cost of a larger question set: every candidate action's parameters are asked speculatively.
- Actions keep their order within an instance, but nothing orders actions across instances; instances are planned independently, so this is accepted.
- Slot 2 is answered without seeing slot 1's answer, since questions in one call are answered independently. The premise labels let code pick the matching branch and defer the rest, so a mismatch costs a fallback, not a wrong plan.
- At most two actions per instance are planned. A third requested action on one instance defers `jevActions/action_limit` to the fallback rather than shipping the first two on their own; slot 3's answers measure how often that happens.

The Phase 3 planners cross the two select stages with the three actions stages, all with `layoutPreset` in the POC's wording and `completeLayoutInline`; the gated arms take `actionsStepwiseGated` where the ungated ones take `actionsStepwise`: `jev-ungated-stepwise-preset-inline`, `jev-ungated-batched-preset-inline`, `jev-ungated-per-instance-preset-inline`, `jev-gated-stepwise-preset-inline` and `jev-gated-batched-preset-inline`.

The Phase 5 arms vary the layout and completion stages on `selectGated` and `actionsBatchedPerInstance`. Each is built by `buildJevStagePlanner` (`src/lib/planners/jev-stage-planner.ts`) from one stage factory per slot, so a further arm, such as the winning layout and completion stages on `actionsBatched`, is one entry in `eval/arms.ts`.

| Arm | Layout | Complete |
| --- | --- | --- |
| `jev-gated-per-instance-preset-inline` | `layoutPreset`, placements wording | `completeLayoutInline` |
| `jev-gated-per-instance-preset-or-llm-inline` | `layoutPresetOrLlm` | `completeLayoutInline` |
| `jev-gated-per-instance-preset-or-llm-parallel` | `layoutPresetOrLlm` | `completeLayoutParallel` |
| `jev-gated-per-instance-spatial-gate-inline` | `layoutSpatialGate` | `completeLayoutInline` |
| `jev-gated-per-instance-spatial-gate-parallel` | `layoutSpatialGate` | `completeLayoutParallel` |
| `jev-gated-per-instance-composed-inline` | `layoutComposed`, 5 size levels | `completeLayoutInline` |
| `jev-gated-per-instance-composed-parallel` | `layoutComposed`, 5 size levels | `completeLayoutParallel` |
| `jev-gated-per-instance-composed-2-size-levels-inline` | `layoutComposed`, 2 size levels | `completeLayoutInline` |
| `jev-gated-per-instance-always-llm-inline` | `layoutAlwaysLlm` | `completeLayoutInline` |
| `jev-gated-per-instance-always-llm-parallel` | `layoutAlwaysLlm` | `completeLayoutParallel` |
| `jev-ungated-per-instance-preset-or-llm-inline` | `layoutPresetOrLlm` (with `selectUngated`) | `completeLayoutInline` |

`jev-gated-per-instance-preset-inline` moved to the placements wording in Phase 5; its Phase 3 records used the POC's wording. There is no `preset-parallel` arm: the preset stage never hands off, so the parallel call would never run. The 2-size-level composed arm exists for the replay pass that picks the size scale (`--replay-through actions` against a recorded gated arm).

### Composed layouts

`layoutComposed` asks one question about the shape and three about each visible Instance, `3n + 1` in one call, and code assembles the tree:

- Shape, one choice: `side_by_side_2` to `side_by_side_k` (a `V` split, parts left to right) or `stacked_2` to `stacked_k` (an `H` split, parts top to bottom), `k` the visible Instance count capped at 4. One more option, `none_of_these`, hands the layout off: the request asks for more than four parts, or for a part inside a part to be divided again.
- Placement, per Instance: `part_1` to `part_k`, the same cap, part 1 leftmost or topmost. A part with two or more Instances runs the other way inside; a part with one is a leaf.
- Position, per Instance: `first` to `fifth` within its part. Ties go to the more probable answer.
- Size, a score per Instance: its share of the Chart by area, normalised across Instances with a small floor. A part's weight is the sum of its Instances' shares; weights are written as small whole numbers.

The three most probable answer combinations each become a tree, checked with `layoutFits`; the first that fits ships, and none fitting hands off. A shape part no Instance was placed in is dropped (recorded as a repair). With no stated arrangement and the same visible Instances, the current tree is kept without a call when it fits; otherwise the call carries the current arrangement in words and a note to keep it. The stage returns a `composition` record (gating route, hand-off cause, every answer by question and Instance, the checked candidates and their dropped parts), which the eval keeps in `stageOutputs.jevLayout.composition`.

Example: calendar, tasks, map, weather and journal are visible, and the request is "Put the calendar and tasks in a narrow column on the left. On the right, stack the map, weather and journal, and give the journal half the height." Jev answers shape `side_by_side_2`; calendar and tasks in `part_1`, map, weather and journal in `part_2`; positions in that order; sizes 0.25, 0.25, 0.5, 0.5 and 1.0, normalised to 0.1, 0.1, 0.2, 0.2 and 0.4. Code builds `["V:1,4", "H", "ID:calendar", "ID:tasks", "H:1,1,2", "ID:map", "ID:weather", "ID:journal"]`: 16 questions, one call.

### Arm names renamed for Phase 5

Phase 5 renamed the stage-library arms to carry all four pipeline segments (`jev-<select>-<actions>-<layout>-<complete>`), so later layout and completion variants read consistently alongside these. `jev-poc` and `baseline` keep their names.

| Old arm name | New arm name |
| --- | --- |
| `jev-ungated-stepwise` | `jev-ungated-stepwise-preset-inline` |
| `jev-ungated-batched` | `jev-ungated-batched-preset-inline` |
| `jev-ungated-batched-per-instance` | `jev-ungated-per-instance-preset-inline` |
| `jev-gated-stepwise` | `jev-gated-stepwise-preset-inline` |
| `jev-gated-batched` | `jev-gated-batched-preset-inline` |
| `jev-gated-batched-per-instance` | `jev-gated-per-instance-preset-inline` |

Phase 3 and 4 records and `tmp/` runs keep the old arm names: nothing under `tmp/` was rewritten. `--replay-arm` still works with those old directory names, since it only names the recording directory to load.

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
| `jevActions/batch_cap` | Stage library only: not even the first batched question fits the question cap. |
| `jevActions/premise_mismatch` | Stage library only: a per-instance second action assumes a view the first action does not lead to. |
| `llmComplete/invalid_layout` | Stage library only: a tree the LLM wrote on a hand-off is malformed, leaves out or adds an Instance, or breaks a minimum size. |
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
| `--arm` | `baseline`, `jev-poc` | A named arm from `eval/arms.ts`; repeat the flag for several. Columns follow the order given, and a repeated name runs once. `jev` is an alias of `jev-poc`. The stage-library arms (`jev-ungated-stepwise-preset-inline` and the other planners listed under Stage library) compose `src/lib/stages-experimental/`. |
| `--repeats` | `3` | Runs per scenario and arm. |
| `--case` | every case | A scenario id; repeat the flag for several. |
| `--model` | the demo's default | OpenAI model for the baseline, `llmComplete` and the fallback. |
| `--out` | `tmp/planner-jev-eval/<timestamp>` | Output directory (`tmp` is gitignored). |
| `--verbose` | off | Logs the Engine and every Jev call to the console. |
| `--replay-from` | none | A previous run's output directory to replay upstream stages from. Needs `--replay-through`. |
| `--replay-through` | none | `select`, `actions` or `layout`: every Jev arm replays the stages up to and including this one from the recorded run, and runs the rest live. |
| `--replay-arm` | none | The arm of the recorded run whose stages are replayed. Required with `--replay-from`. |
| `--grader` | off | Grades every planned shipped response with the TypeSafe grader (see Grader below). |
| `--grader-validation` | none | A `grader-validation.json` written by `eval/grader-validate.ts`. The grader's rows appear in `report.md` only when it passed the gate. Needs `--grader`. |

Without `OPENAI_API_KEY`, `TYPESAFE_API_KEY` or `JEV_MODEL` the runner writes `status.json` naming the missing variables and exits with code 2. Live runs are not part of `nx test`; the offline tests use a scripted TypeSafe transport and a mocked `chat()`.

Each Jev turn writes its stages' inputs and outputs to `<out>/stages/<arm>/<scenarioId>-<repeat>.json`. Replay reads them back: a replayed stage returns the recorded output (or the same deferral), so the stage after it runs on identical upstream results. Jev and LLM replies are not deterministic, so replay isolates one stage; it never stands in for an end-to-end result. A turn with no recorded stage fails with an error naming the stage and turn. Before any call, the runner also refuses a recording that lacks what an arm reads from a replayed stage: stage-library arms read `minConfidence` from a replayed action plan, gated arms read every gate from a replayed selection and action plan, and ungated arms refuse a recording that carries gates, since their actions stage would act on them. Replay gated arms from a gated arm's run and ungated arms from an ungated one.

### Stage evals

`eval-stages/` tests one pipeline stage on its own, so a stage can be tuned in minutes before a full-planner run. It calls the stage function directly on the input a scenario's expectation implies: no planner, no Engine, no replay and no LLM. Only the layout stage is covered so far. Use it while changing a stage's questions, options or code; use the full-planner eval above for the final comparison of whole planners, since a stage that scores well alone can still lose to the completion call or the fallback.

```sh
# from the workspace root, so Bun loads .env (TYPESAFE_API_KEY and JEV_MODEL; no OpenAI key is needed)
bun packages/planner-jev/eval-stages/cli.ts --stage layout --variant composed --variant composed-2-size-levels --suite development --repeats 3 --out tmp/planner-jev-eval/<name>
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--stage` | required | The stage to test: `layout`. |
| `--variant` | every variant of the stage | Repeat the flag for several; columns follow the order given. Layout variants: `preset` (the preset choice with placement descriptions), `preset-or-llm`, `spatial-gate`, `composed` (5 size levels), `composed-2-size-levels`, `always-llm`, and `composed-score-sized` and `composed-2-size-levels-score-sized` (the composed stage before the size fix, `eval-stages/layout-composed-score-sized.ts`, kept to measure that fix). Each is built as the matching arm in `eval/arms.ts` builds its layout stage. |
| `--suite` | `development` | `development`, `holdout` or `all`. |
| `--repeats` | `3` | Runs per scenario and variant. |
| `--case` | every case | A scenario id; repeat the flag for several. |
| `--concurrency` | `1` | Turns in flight at once. Latency is measured per call, so raising it can inflate the latency rows. |
| `--out` | `tmp/planner-jev-eval/stage-<stage>-<timestamp>` | Output directory. |
| `--verbose` | off | Logs every Jev call to the console. |

The layout stage gets gold inputs from `eval-stages/gold-inputs.ts`: the expected selection and action plan, with every gate (`spatial` yes only for scenarios tagged `spatial: true`). A scenario that cannot form them (it expects a deferral, or states no visible set or actions) is recorded once per variant as not applicable and does not run. Each turn ends in one outcome:

- **pass** or **fail**: the decision wrote a tree, scored with `scoreLayout` (the tree's leaves against the expected visible set, then the arrangement rules of `eval/predicates.ts`, including `unchangedTree`) and a fit check (every visible Instance once, within the Chart, at its variant's minimum size).
- **handed off**: the decision has no tree, so the completion call would write the layout; neither pass nor fail.
- **deferred** or **error**: the stage deferred (a provider failure, an answer missing) or failed.

`records.json` keeps every turn with its outcome, failures, the decision (source, tree, answers), and every Jev call with its raw answers, probabilities, usage, latency and the state the stage sent, for debugging prompts. `meta.json` holds the run's settings. `report.md` has one column per variant: turns run, the pass rate with hand-offs and deferrals counted as failures, the pass rate over the turns that wrote a tree, hand-off rate, deferrals and errors, not-applicable scenarios, Jev calls per turn, Jev call latency p50 and p95, stage latency, Jev tokens per turn, and one row per deferral reason. For the composed variants a further table shows the gating routes (turns and calls), hand-off causes, the chosen candidate's rank, missed turns (failed or handed off) by the first question answered differently from the scenario's reference tree (shape, then placement, then position, and size when those all match; `no_call` when no Jev call was made), and the wrong-answer rates per question. The reference tree is the scenario's `tree`, or the current tree when the scenario expects it unchanged. A per-scenario table lists passes over turns run for every variant, with hand-offs (`h`), deferrals (`d`) and errors (`e`), so a regression on one scenario stands out.

A new stage joins by implementing `StageEvalModule` in `eval-stages/stage-eval.ts` (its variants, how a scenario forms its input, how an output is judged, and any extra report sections) and registering it in `eval-stages/stages.ts`.

### Reading the report

`report.md` puts the arms side by side for each suite, one column per arm in the order given (`records.json` has every turn, `summary.json` the numbers and the run's settings, including `replay` when stages were replayed). `paired.md` lists every scenario and repeat where the arms disagree on pass, with each arm's failures.

- **Overall pass**: shipped responses with the expected visible and retained instances, the expected ordered actions and parameters, the scenario's arrangement rules, and every existing instance declared in the variant the shipped execution plan leaves it in. New instances match by Vessel and order, so the baseline's own ids score fairly. Scenarios where the POC is expected to defer are left out of every arm and reported as **Expected deferrals at the right stage** for the Jev arms.
- **Arrangement pass**: the shipped tree against the scenario's arrangement rules (`eval/predicates.ts`: order, left of, above, dominant share, full width or height, side by side, stacked, unchanged tree, area ratio), whichever arm or fallback wrote the tree. The denominator is every planned turn whose scenario declares rules; a turn that errored, shipped no response or shipped a non-tiling layout counts as a failure.
- **Decisive turns** (Jev arms): planned turns no stage deferred, their pass rate, and wins and losses against the baseline on the same scenario and repeat.
- **Selection / Actions / Layout accuracy** (Jev arms): each stage's own output against the expectation. Selection compares the visible and retained sets, actions compare the ordered actions, bound parameters and asks (a `stated_elsewhere` slot counts when the expectation has a value for it), layout compares the tree's leaves with the visible set and checks the arrangement rules.
- **Fallbacks** (Jev arms): the fallback rate, then one row per `<stage>/<code>` deferral reason.
- **llmComplete fill rate**: filled `stated_elsewhere` slots over all such slots; a `param_unfilled` deferral counts all of its turn's slots as unfilled.
- **Gates**: for arms whose select stage asks gates, false positives and negatives over the turns whose live select call answered them: `needsActions` against whether the scenario expects any action, `spatial` against its spatial tag. Without gate answers the spatial row shows how many turns are tagged spatial and how many are non-spatial controls.
- **Arrangement turns reaching jevLayout**: planned turns with arrangement rules whose layout stage ran or was replayed, rather than an earlier stage deferring.
- **Jev calls per turn**: TypeSafe calls over all turns of the arm.
- **Latency**: p50 and p95 of the whole turn, each live stage (replayed stages show `replayed`), each Jev call and each LLM call by role.
- **Tokens**: Jev usage from its replies, in total and per turn, and OpenAI usage per role (`planner`, `fallback`, `complete`), recorded by wrapping the text adapter.

### Grader (secondary)

`eval/grader.ts` rates each shipped response of a planned scenario with one TypeSafe call asking two `score` questions of five descriptive levels each: `request_satisfied` (did everything the user asked happen, and nothing else) and `arrangement_match` (does the layout match the stated arrangement, or with none stated, keep the previous one or use a sensible default). The state it reads is the user's intent, the layout before and after in words (`eval/verbalize-tree.ts`), the shipped execution plan and the user message. A score is the fractional level normalised to 0 to 1. A dimension whose two most probable levels are within 0.15 of each other is asked twice more on its own and scores the mean of the three samples. Grading runs after the turn's latency is measured, on its own TypeSafe client: its usage is reported in the grader rows and never in an arm's Jev tokens. A failed grade (provider error, deferral) is recorded in the turn's `grader` field and counted, and never changes the turn or any rule-based metric.

The rule-based pass stays the primary metric. The grader reads the LLM-written `userMessage` and the plan, so it may prefer fluent messages and plans shaped like Jev's own (self-preference). That is why it is secondary and must be validated before it appears in a report:

```sh
# from the workspace root, so Bun loads .env
bun packages/planner-jev/eval/grader-validate.ts --records tmp/planner-jev-eval/<run>/records.json
```

It grades the hand-labelled responses and every planned development turn whose scenario declares arrangement rules, then writes `grader-validation.json` next to the records (or under `--out`). Grades are cached in `grader-scores.json` (`--scores` to name another file) and reused while the grader and verbalizer versions match, so a re-validation calls TypeSafe only for responses not yet graded. `--arm` narrows the arrangement turns to some arms, `--limit` caps how many responses are graded live, `--offline` grades nothing and validates the cached grades, `--labels` reads another labels file, and `--verbose` logs every call and provider error. A record written before the grader existed carries no shipped plan: its completion stage's candidate, healed again by the Engine, stands in when the turn did not fall back and the healed message and tree are the ones the record shipped; for a turn recorded against a scenario that expected no actions, the rule-based score proves an empty plan; any other such turn is skipped and counted in the summary line.

The labels live in `eval/fixtures/grader-labels.ts`, which exports `graderLabels`: hand scores from 0 to 1 per dimension for 15 to 20 recorded responses, each identified by the record's `scenarioId`, `arm` and `repeat` (type `GraderLabel` in `eval/grader-validate.ts`), with an optional `note`. Without the file there are no labels. Validation reports, per dimension, the Spearman rank correlation and the mean absolute error against the labels, and the pass/fail agreement (a grade of at least 0.5 against the rule-based arrangement pass). The gate passes when at least 10 labels matched, the weaker dimension's rank correlation is at least 0.7 and agreement is at least 85%, with the current grader and verbalizer versions. Otherwise, or without `--grader-validation`, `report.md` prints `grader: unvalidated (rho=..., agreement=...)` in place of the grader rows, `n/a` for a value that could not be computed; `summary.json` keeps the grader numbers either way.

`records.json` also carries every answer of the turn's live Jev calls with its confidence (deferred stages included; replayed stages make no calls) and the lowest confidence among the answers the completed stages consumed, replayed stages included. It is recorded, not enforced.
