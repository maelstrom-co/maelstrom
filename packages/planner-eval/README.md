# @maelstrom-co/planner-eval

Live evals for Maelstrom planners. Workspace-internal: the package is private, has no build and runs with `bun`. It depends on `@maelstrom-co/planner-jev` (through its `_eval` and `_testing` subpaths), `@maelstrom-co/planner-llm`, `@maelstrom-co/engine` and `@maelstrom-co/protocol`; nothing depends on it.

Two evals live here: the full-planner eval runs whole planners through `createEngine` and compares named arms, the stage eval runs one pipeline stage on gold inputs. The runners are generic and live in `src/core/`; everything that knows a planner family lives in a plugin under `src/plugins/` (see Plugins below). The Jev plugin reads planner-jev's stages and planners through `@maelstrom-co/planner-jev/_eval`, and its offline tests read the fixtures and scripted transports through `@maelstrom-co/planner-jev/_testing`. Both subpaths are unsupported outside this repository. There are four entry points: `src/eval/cli.ts` (the full-planner eval, the nx `eval` target), `src/eval-stages/cli.ts` (the stage eval, the nx `eval-stages` target), `src/eval/report-cli.ts` (rebuilds a run's report from its records) and `src/eval/grader-validate.ts` (validates the grader). Each only hands the registered plugins, `evalPlugins` from `src/plugins/index.ts`, to its runner in `src/core/`.

## Plugins

`src/core/` never imports a planner package: it takes every planner-specific piece from a `PlannerEvalPlugin` (`src/core/plugin.ts`). Two plugins are registered today: `src/plugins/llm/plugin.ts` (the `baseline` arm on `@maelstrom-co/planner-llm`, and the fallback planner the staged arms run on a deferral) and `src/plugins/jev/plugin.ts` (the eleven Jev arms, the Jev fields of the records and the report, the TypeSafe judge and the layout stage eval).

A plugin declares:

| Field | Meaning |
| --- | --- |
| `name`, `arms` | Arms by unique name. An arm has a `build(deps)` that returns a `Planner`, wrapping every stage it wants recorded in `deps.instrument(name, stage)` and reporting its provider calls to `deps.onCall`. `baseline: true` marks a reference arm: no stages, no replay, paired against by the others. `requiredEnv` lists the variables the arm needs; `kind` labels its records (the plugin's name when absent). |
| `defaultArms`, `aliases` | What `--arm` runs when absent, and other names it accepts. |
| `stageOrder`, `phases` | The pipeline's stage names in order, and the stage each planner-neutral phase (`select`, `actions`, `layout`) maps to. The scenarios' `deferStage` expectations and `--replay-through` name phases, never stages, so they hold for every plugin. The arm registry refuses a plugin that maps an unknown phase or a stage outside `stageOrder`, and the runner refuses, before any turn, a scenario whose `deferStage` the plugin of a selected staged arm does not map. |
| `fallback(adapter)` | The planner staged arms fall back to; the CLI takes the first plugin that offers one. |
| `verifyReplay(record, arm)` | What a replayed stage output lacks for the arm to read it, checked before any turn runs. |
| `recordTurn(scenario, stages, calls)` | Fields added to a staged turn's record in `records.json`. Naming a field the runner owns throws. |
| `summarizeArm(records)`, `reportRows(summaries)` | Fields added to an arm's summary in `summary.json` (`latency` and `tokens` merge into the runner's; naming a field the runner owns throws), and rows added to each suite's table in `report.md`, by section. |
| `judge` | Rates shipped responses for `--grader` (`Judge`: one `score(input, ctx)` call per grading, returning a level and level probabilities per dimension, with its own provider calls). The grader's questions, levels, state and resampling stay in `src/core/grader.ts`; the TypeSafe judge in `src/plugins/jev/typesafe-judge.ts` only maps them to a TypeSafe call. |
| `stageModules` | Single-stage evals for `--stage`, each a `StageEvalModule` (`src/core/stage-eval.ts`): its `name`, the `stage` it records, `variants` as factories over the module's own `Deps`, `makeDeps(onCall)` building those deps for one turn, optional CLI `flags` with a `configure(values, run)` that returns the module to run and the settings for `meta.json`, plus `prepare`, `judge` and `reportSections` as before. |
| `meta()` | Settings printed with the run's meta whenever one of the plugin's arms runs (the Jev plugin adds `jevModel`). |

A new planner family, or a prompt experiment on `@maelstrom-co/planner-llm`, registers its arms in a plugin under `src/plugins/<name>/plugin.ts` and adds it to `evalPlugins` in `src/plugins/index.ts`, which every entry point reads; its `stageModules` then appear in the stage eval too. Every run needs `OPENAI_API_KEY`, since core builds the OpenAI adapter behind every LLM role and the fallback; beyond it, only the arms selected with `--arm` decide which environment variables a run needs, so `--arm baseline` runs with `OPENAI_API_KEY` alone. `src/core/boundary.test.ts` fails when a file under `src/core/` imports a planner package or anything outside `src/core/`. The scorers replay an Execution Plan with `finalVariants` from `@maelstrom-co/engine`. They keep a copy of planner-jev's layout geometry in `src/core/geometry.ts`, since core may not import planner-jev and no shared geometry package exists yet; `src/plugins/jev/geometry.test.ts` holds it equal to planner-jev's.

Bun resolves workspace packages to their built `dist/` unless told otherwise, so every entry point here runs with `--conditions=@maelstrom-co/source`: planner-jev, planner-llm, engine and protocol then load from `src/`, the way `tsc` reads them, and a stage edit is measured without a rebuild. The nx targets (`eval`, `eval-stages`, `test`) pass the flag; pass it yourself when running a file with `bun` directly, as the commands below do. Without it Bun loads the last build and quietly measures stale code.

## Evaluating

`src/core/run.ts` holds a live runner that compares named planners (arms, registered by the plugins; the Jev arms in `src/plugins/jev/arms.ts`) on the same scenarios: the tiling scenarios of the Jev prototype, keep-versus-replace cases, parameter cases that separate `stated_elsewhere` from `not_stated`, explicit arrangement requests scored by arrangement rules (swap, big instance on the right, mixed row-and-split, edge strip, reorder, a 2x2 grid and more, tagged `spatial: true`) and non-spatial controls that should leave the arrangement alone (content edits, view changes, an added widget, tagged `spatial: false`). Any arm may satisfy an arrangement rule, the Jev arms' fallback included; the fallback columns show who did. Every arm runs through `createEngine` with history off and `retry: false`; the baseline is the same once-retried `llmPlanner` (from `@maelstrom-co/planner-llm`) the Jev arms fall back to, so the arms differ only in their pipelines. Scores use the shipped (validated and healed) response.

```sh
OPENAI_API_KEY=... TYPESAFE_API_KEY=... JEV_MODEL=jev-1.13.0 \
  bunx nx run @maelstrom-co/planner-eval:eval -- --suite all --arm baseline --arm jev-poc --repeats 3
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--suite` | `all` | `development`, `holdout` or `all`. |
| `--arm` | `baseline`, `jev-poc` | A named arm of any registered plugin; repeat the flag for several. Columns follow the order given, and a repeated name runs once. `jev` is an alias of `jev-poc`. The stage-library arms (`jev-ungated-stepwise-preset-inline` and the other planners listed in the planner-jev README under Stage library) compose the stages in planner-jev's `src/lib/stages/` and `src/lib/stages-experimental/`. |
| `--repeats` | `3` | Runs per scenario and arm. |
| `--case` | every case | A scenario id; repeat the flag for several. |
| `--model` | the demo's default | OpenAI model for the baseline, `llmComplete` and the fallback. |
| `--out` | `tmp/planner-eval/<timestamp>` | Output directory (`tmp` is gitignored). |
| `--verbose` | off | Logs the Engine and every Jev call to the console. |
| `--replay-from` | none | A previous run's output directory to replay upstream stages from. Needs `--replay-through`. |
| `--replay-through` | none | `select`, `actions` or `layout`: every staged arm replays its plugin's stages up to and including the one mapped to this phase from the recorded run, and runs the rest live. |
| `--replay-arm` | none | The arm of the recorded run whose stages are replayed. Required with `--replay-from`. |
| `--grader` | off | Grades every planned shipped response with the first plugin's judge, TypeSafe today (see Grader below). |
| `--grader-validation` | none | A `grader-validation.json` written by `src/eval/grader-validate.ts`. The grader's rows appear in `report.md` only when it passed the gate. Needs `--grader`. |

Without a variable the run needs (`OPENAI_API_KEY` always; the Jev arms also need `TYPESAFE_API_KEY` and `JEV_MODEL`, and so does `--grader`) the runner writes `status.json` naming the missing variables and exits with code 2. Live runs are not part of `nx test`; the offline tests use a scripted TypeSafe transport and a mocked `chat()`.

Each staged turn writes its stages' inputs and outputs to `<out>/stages/<arm>/<scenarioId>-<repeat>.json`. Replay reads them back: a replayed stage returns the recorded output (or the same deferral), so the stage after it runs on identical upstream results. Jev and LLM replies are not deterministic, so replay isolates one stage; it never stands in for an end-to-end result. A turn with no recorded stage fails with an error naming the stage and turn. Before any call, the runner also refuses a recording that lacks what an arm's plugin says it reads from a replayed stage: stage-library arms read `minConfidence` from a replayed action plan, gated arms read every gate from a replayed selection and action plan, and ungated arms refuse a recording that carries gates, since their actions stage would act on them. Replay gated arms from a gated arm's run and ungated arms from an ungated one.

### Stage evals

`src/core/stage-eval.ts` tests one pipeline stage on its own, so a stage can be tuned in minutes before a full-planner run. It calls the stage function directly on the input a scenario's expectation implies: no planner, no Engine, no replay and no LLM. Only the layout stage is covered so far. Use it while changing a stage's questions, options or code; use the full-planner eval above for the final comparison of whole planners, since a stage that scores well alone can still lose to the completion call or the fallback.

```sh
# from the workspace root, so Bun loads .env (TYPESAFE_API_KEY and JEV_MODEL; no OpenAI key is needed)
bun --conditions=@maelstrom-co/source packages/planner-eval/src/eval-stages/cli.ts --stage layout --variant preset-or-llm --variant composed-pairs --suite development --repeats 3 --out tmp/planner-eval/<name>
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--stage` | required | The stage to test: `layout`. |
| `--variant` | every variant of the stage | Repeat the flag for several; columns follow the order given. Layout variants: `preset` (the preset choice with placement descriptions), `preset-or-llm` and `composed-pairs` (the composed pairs planner's layout stage), listed in `LAYOUT_STAGES`, `src/plugins/jev/stages/layout.ts`. Each is built as the matching arm in `src/plugins/jev/arms.ts` builds its layout stage. |
| `--suite` | `development` | `development`, `holdout` or `all`. |
| `--repeats` | `3` | Runs per scenario and variant. |
| `--case` | every case | A scenario id; repeat the flag for several. |
| `--concurrency` | `1` | Turns in flight at once. Latency is measured per call, so raising it can inflate the latency rows. |
| `--out` | `tmp/planner-eval/stage-<stage>-<timestamp>` | Output directory. |
| `--verbose` | off | Logs every Jev call to the console. |

The layout stage gets gold inputs from `src/plugins/jev/gold-inputs.ts`: the expected selection and action plan, with every gate (`spatial` yes only for scenarios tagged `spatial: true`). A scenario that cannot form them (it expects a deferral, or states no visible set or actions) is recorded once per variant as not applicable and does not run. Each turn ends in one outcome:

- **pass** or **fail**: the decision wrote a tree, scored with `scoreLayout` (the tree's leaves against the expected visible set, then the arrangement rules of `src/core/predicates.ts`, including `unchangedTree`) and a fit check (every visible Instance once, within the Chart, at its variant's minimum size).
- **handed off**: the decision has no tree, so the completion call would write the layout; neither pass nor fail.
- **deferred** or **error**: the stage deferred (a provider failure, an answer missing) or failed.

`records.json` keeps every turn with its outcome, failures, the decision (source, tree, answers), and under `calls` every Jev call with its raw answers, probabilities, usage, latency and the state the stage sent, for debugging prompts. `meta.json` holds the run's settings. `report.md` has one column per variant: turns run, the pass rate with hand-offs and deferrals counted as failures, the pass rate over the turns that wrote a tree, hand-off rate, deferrals and errors, not-applicable scenarios, Jev calls per turn, Jev call latency p50 and p95, stage latency, Jev tokens per turn, and one row per deferral reason. For the composed pairs variant a further table shows the gating routes (turns and calls), hand-off causes, the chosen candidate's rank, size fallbacks, the pair answers compared with the scenario's reference tree (wrong, not stated, wrong in the returned tree, the reference among the top candidates), direction answers, size rule failures and size answer confidence. The reference tree is the scenario's `tree`, or the current tree when the scenario expects it unchanged. A per-scenario table lists passes over turns run for every variant, with hand-offs (`h`), deferrals (`d`) and errors (`e`), so a regression on one scenario stands out.

A new stage joins by implementing `StageEvalModule` (`src/core/stage-eval.ts`: its variants over the deps `makeDeps` builds, how a scenario forms its input, how an output is judged, any CLI flags, and any extra report sections) and listing it in its plugin's `stageModules`.

### Reading the report

`report.md` puts the arms side by side for each suite, one column per arm in the order given (`records.json` has every turn, `summary.json` the numbers and the run's settings, including `replay` when stages were replayed). `paired.md` lists every scenario and repeat where the arms disagree on pass, with each arm's failures.

- **Overall pass**: shipped responses with the expected visible and retained instances, the expected ordered actions and parameters, the scenario's arrangement rules, and every existing instance declared in the variant the shipped execution plan leaves it in. New instances match by Vessel and order, so the baseline's own ids score fairly. Scenarios where the POC is expected to defer are left out of every arm and reported as **Expected deferrals at the right stage** for the Jev arms.
- **Arrangement pass**: the shipped tree against the scenario's arrangement rules (`src/core/predicates.ts`: order, left of, above, dominant share, full width or height, side by side, stacked, unchanged tree, area ratio), whichever arm or fallback wrote the tree. The denominator is every planned turn whose scenario declares rules; a turn that errored, shipped no response or shipped a non-tiling layout counts as a failure.
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

`src/core/grader.ts` rates each shipped response of a planned scenario with one judge call, a TypeSafe call asking two `score` questions of five descriptive levels each: `request_satisfied` (did everything the user asked happen, and nothing else) and `arrangement_match` (does the layout match the stated arrangement, or with none stated, keep the previous one or use a sensible default). The state it reads is the user's intent, the layout before and after in words (`src/core/verbalize-tree.ts`), the shipped execution plan and the user message. A score is the fractional level normalised to 0 to 1. A dimension whose two most probable levels are within 0.15 of each other is asked twice more on its own and scores the mean of the three samples. Grading runs after the turn's latency is measured, on its own TypeSafe client: its usage is reported in the grader rows and never in an arm's Jev tokens. A failed grade (provider error, deferral, or `grader/exception: <message>` when the judge throws, with the judge calls made before it) is recorded in the turn's `grader` field and counted, and never changes the turn or any rule-based metric.

The rule-based pass stays the primary metric. The grader reads the LLM-written `userMessage` and the plan, so it may prefer fluent messages and plans shaped like Jev's own (self-preference). That is why it is secondary and must be validated before it appears in a report:

```sh
# from the workspace root, so Bun loads .env
bun --conditions=@maelstrom-co/source packages/planner-eval/src/eval/grader-validate.ts --records tmp/planner-eval/<run>/records.json
```

It grades the hand-labelled responses and every planned development turn whose scenario declares arrangement rules, then writes `grader-validation.json` next to the records (or under `--out`). Grades are cached in `grader-scores.json` (`--scores` to name another file) and reused while the grader and verbalizer versions match, so a re-validation calls TypeSafe only for responses not yet graded. `--arm` narrows the arrangement turns to some arms, `--limit` caps how many responses are graded live, `--offline` grades nothing and validates the cached grades, `--labels` reads another labels file, and `--verbose` logs every call and provider error. A record written before the grader existed carries no shipped plan: its completion stage's candidate, healed again by the Engine, stands in when the turn did not fall back and the healed message and tree are the ones the record shipped; for a turn recorded against a scenario that expected no actions, the rule-based score proves an empty plan; any other such turn is skipped and counted in the summary line.

The labels live in `src/core/fixtures/grader-labels.ts`, which exports `graderLabels`: hand scores from 0 to 1 per dimension for 15 to 20 recorded responses, each identified by the record's `scenarioId`, `arm` and `repeat` (type `GraderLabel` in `src/core/grader-validate.ts`), with an optional `note`. Without the file there are no labels. Validation reports, per dimension, the Spearman rank correlation and the mean absolute error against the labels, and the pass/fail agreement (a grade of at least 0.5 against the rule-based arrangement pass). The gate passes when at least 10 labels matched, the weaker dimension's rank correlation is at least 0.7 and agreement is at least 85%, with the current grader and verbalizer versions. Otherwise, or without `--grader-validation`, `report.md` prints `grader: unvalidated (rho=..., agreement=...)` in place of the grader rows, `n/a` for a value that could not be computed; `summary.json` keeps the grader numbers either way.

`records.json` also carries every answer of the turn's live Jev calls with its confidence (deferred stages included; replayed stages make no calls) and the lowest confidence among the answers the completed stages consumed, replayed stages included. It is recorded, not enforced.
