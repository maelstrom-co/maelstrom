# @maelstrom-co/planner-jev

Experimental, server-only Maelstrom planner built on TypeSafe's Jev model. Jev answers typed multiple-choice questions quickly and cheaply but writes no text, so this planner hands it the multiple-choice-shaped decisions and keeps one small LLM call for the reply.

The package is demo-only. It serves the local demo (`MAELSTROM_PLANNER=jev`, or `jev-composed-pairs` for the experimental planner below) and the comparison eval. The hosted demo keeps the plain `llmPlanner` from `@maelstrom-co/planner-llm`.

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
import { createEngine } from '@maelstrom-co/engine';
import { llmPlanner } from '@maelstrom-co/planner-llm';
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

### Composed pairs planner (experimental)

`jevComposedPairsPlanner(options)` takes the same options as `jevPlanner` and runs the same way. It is the eval arm `jev-gated-per-instance-composed-pairs-gate-and-defer-inline`: `selectGated`, `actionsBatchedPerInstance`, `layoutComposedPairsGateAndDefer` and `completeLayoutInline` (see Stage library). Its layout stage asks where the request puts each pair of visible Instances and how much space each gets, and code builds the tree, instead of choosing from precomputed layouts. `buildJevComposedPairsPlanner` (`src/lib/planners/jev-composed-pairs.ts`) builds it for the eval arm, the export and the demo alike.

It is not the default: `jevPlanner` passed more holdout scenarios in the comparison eval. The demo selects it with `MAELSTROM_PLANNER=jev-composed-pairs` so the composed layout can be tried in a real UI.

### OpenAI Decisions client (internal)

Every planner builder takes its provider as an `Ask`, so the same stages can be answered by another typed-decision provider. The workspace-internal `createDecisionsClient` (from `_internal`) is one: it asks the same typed questions through OpenAI's Decisions API (public beta, `POST https://api.openai.com/v1/decisions`, model `gpt-6-luna`) so the eval can compare providers. It is not a shipped planner and the root entry does not export it.

Questions map onto Decisions types: `noul` to `predicate`, `choice` to `choice` (one value per option key) and `score` to `score` (levels labelled "0" to "n-1", where the level is the most probable one, not the rounded fractional score). The evaluation state and every object-valued question text are rendered to text with `JSON.stringify`, unless the client's `render` option replaces that. Question ids and option keys are sent as-is.

Decisions can refuse a question. A refusal of any question makes the call defer with `<stage>/provider_refusal`, naming the first refused question, and the fallback answers the turn. TypeSafe never refuses. In one recorded composed pairs layout call, Decisions deterministically refuses the benign `fraction_in_group/calendar-main` score question, so that call defers to the fallback.

The client emits the same `jev.call`, `jev.provider_failure` and (with `logReplies`) `jev.reply` logs, and the same `jev.call` instrument event, as the TypeSafe client.

## Stage library

The stage library composes named planners from interchangeable stages with `pipeline(...)`, each wrapped in the same fallback. Every stage keeps the POC's stage names (`jevSelect`, `jevActions`, `jevLayout`, `llmComplete`), so deferral reasons, the report and replay treat them alike. The eval runs every planner as an arm.

### Chosen and experimental code

Chosen code is what ships: the two planners that are exported and selectable in the demo, `jevPlanner` and `jevComposedPairsPlanner`, and every stage and utility they run. `jevComposedPairsPlanner` keeps its `@experimental` tag in the public API because it is still being tried in a real UI, but it is the chosen direction, so it and its stages live with the chosen code. Everything else is experiment code: the Phase 3 planners and the stages only they, the eval arms or the stage eval use.

| Folder | Holds |
| --- | --- |
| `src/lib/` | `jevPlanner` (`jev-planner.ts`) and the helpers every stage shares: questions, layouts, fit checks, deferral, the TypeSafe client. |
| `src/lib/` (provider layer) | The provider-neutral `Ask`, call outcomes and answers (`ask.ts`), the call flow every provider shares around its transport (`provider-call.ts`), the fetch step every fetch transport shares, with its bounded body reads and error field check (`provider-fetch.ts`, `error-identifier.ts`), the reply checks (`reply-validation.ts`) and the OpenAI Decisions client (`openai-decisions-client.ts`). |
| `src/lib/stages/` | Chosen stages: the frozen POC stages (`jev-select.ts`, `jev-actions.ts`, `jev-layout.ts`, `llm-complete.ts`), the composed pairs planner's stages (`select-gated.ts`, `actions-batched-per-instance.ts`, `layout-composed-pairs-gate-and-defer.ts` with its `-tree.ts` and `-sizes.ts` helpers, `complete-layout-inline.ts`) and the stage utilities both sides share (`stage-types.ts`, `stage-deps.ts`, `fan-out.ts`, `action-plan.ts`, `layout-describe.ts`). |
| `src/lib/planners/` | Chosen planners: `jev-composed-pairs.ts` and the shared pipeline builder `jev-stage-planner.ts`. |
| `src/lib/stages-experimental/` | Stages only experiments use. |
| `src/lib/planners-experimental/` | The Phase 3 planners (`jev-gated-*`, `jev-ungated-*`). |

Chosen code never imports from `stages-experimental/` or `planners-experimental/`; experiment code may import chosen code. `src/lib/experimental-boundary.test.ts` enforces the rule on every non-test file outside the experimental folders. Tests and `__test-helpers__` are exempt, so a test of chosen code may use an experimental stage as a fixture. Deleting an experiment therefore never touches what ships. When an experimental stage wins, move it to `stages/` (renaming the moved file on a name clash, never a POC file).

### Stages

| Stage | Folder | Replaces | What it does |
| --- | --- | --- | --- |
| `selectUngated` | `stages-experimental/` | `jevSelect` | The POC's selection, unchanged. |
| `selectGated` | `stages/` | `jevSelect` | The POC's selection plus four yes/no (`noul`) questions in the same call: `needsActions` (the intent changes what a widget shows, including a different view of its data such as a route, a forecast or a chart, or edits its content, not only showing, hiding, removing or arranging), `generatedContent` (the intent wants an answer written in the reply or live outside data that no action parameter could take), `spatial` (the intent states where something goes or how large it is) and `dependsOnScreen` (the intent wants content the user already has in a widget, such as the schedule, the task list or a chart, summarised, copied, counted or turned into new content). `needsActions` answers yes at a probability of 0.3 or more (`NEEDS_ACTIONS_THRESHOLD`), since a false no drops the requested actions; the others at 0.5 or more (`GATE_THRESHOLD`). Every probability is kept on the selection's `gates`. A generated-content yes defers `jevSelect/scope_unsupported`; otherwise a screen-content yes defers `jevSelect/screen_content_unavailable`, since a request carries no widget content. `spatial` is recorded for later layout stages. |
| `actionsStepwise` | `stages-experimental/` | `jevActions` | The POC's actions, one call per step plus one per parameterised action. |
| `actionsStepwiseGated` | `stages-experimental/` | `jevActions` | `actionsStepwise` behind the `needsActions` gate: a gated selection answering no plans no actions and makes no call, anything else runs the stepwise stage unchanged. |
| `actionsBatched` | `stages-experimental/` | `jevActions` | State-keyed batching, two calls. The first asks, for every variant state the request can reach by transitions, which action comes next at each depth up to the action limit (`action/0`, then `action/<depth>@<state>`, the state named by the instances whose view changed, `same` when none did). Questions are keyed by state, not by the actions that led there, so two orders reaching the same views share a question. Code walks the answers from the current views. Past `MAX_BATCH_QUESTIONS` (48) whole depths are left out and asked one call per step. The second call binds every chosen action's parameters at once, with the same parameter questions as the stepwise stage. |
| `actionsBatchedPerInstance` | `stages/` | `jevActions` | Per-instance batching, one call: for each instance, slot 1 (its first action, `none` or `unsupported`), slot 2 (its second action, each option labelled with the view slot 1 leaves it in, for example `week:addEvent`) and slot 3 (never planned: an answer naming an action defers `jevActions/action_limit`, the rest is measurement), plus the parameters of every action any slot could pick. Code takes slot 2 only when its label matches the view slot 1's answer leads to; any other label defers `jevActions/premise_mismatch`. When slot 1 answers `none` and slot 2 names an action, that action is promoted (see below). Parameter answers off the walked path are discarded. |
| `layoutPreset` | `stages-experimental/` | `jevLayout` | The POC's choice over precomputed layouts. Never hands off. With `describe: 'placements'` each layout is described by its Instances and positions ("Stacked: calendar-main and weather-main side by side on top, tasks-main full width below.") instead of by its split tokens, and layouts placing every Instance on the same rectangles are offered once; the default keeps the POC's wording and call. |
| `layoutPresetOrLlm` | `stages-experimental/` | `jevLayout` | One Jev call with the placements menu and two yes/no questions: `needsChange` (the request states an arrangement different from the current one) and `needsBetter` (no offered layout is that arrangement). No change keeps the current tree when it fits, else the balanced default; needing better hands the layout off; otherwise the chosen layout ships. |
| `layoutComposedPairsGateAndDefer` | `stages/` | `jevLayout` | Composes the tree from Jev's answers about pairs of visible Instances in one call (see below). Its input type requires the gates, so a planner with `selectUngated` does not compile. |
| `completeLayoutInline` | `stages/` | `llmComplete` | The POC's completion call; when a layout stage hands the layout off, the LLM also writes the tree. |
| `completeLayoutParallel` | `stages-experimental/` | `llmComplete` | On a hand-off, runs the message-only completion call and a small tree-only layout call in parallel; a failure in either aborts the other. With a tree from the layout stage it is the same single call as `completeLayoutInline`. |

The balanced default, shared by the layout stages that keep or default, is the first that fits of one side-by-side row, two stacked rows and three stacked rows (the `row`, `rows_2` and `rows_3` layouts of the preset menu); a lone Instance fills the Chart. When none fits, the layout is handed off.

Both batched stages and `actionsStepwiseGated` skip their call when a gated selection's `needsActions` answers no, and plan no actions on a resize-only turn. Both batched stages check the planned actions against the simulated views and defer `jevActions/simulation_failed` when a dropped action leaves a later one invalid.

The per-instance stage also reads slot 2 when slot 1 answers `none`, since Jev sometimes places an instance's only action in the second slot. An action there is promoted to the instance's only action: as answered when its premise view is the instance's current view, else as the current view's action of the same name, bound from its own slot 1 parameter answers because the slot 2 target's parameters belong to another view's definition. When neither applies the stage logs `jev.slot_discarded` and defers `jevActions/premise_mismatch`; a promotion logs `jev.slot_promoted` with `via: 'premise'` or `via: 'same_name'`. After a promotion slot 3 is still read: an answer naming an action defers `jevActions/action_limit`, as after two actions. A promoted action counts toward the action limit, and an `unsupported` slot 2 behind a `none` slot 1 defers `jevActions/action_unsupported`.

Duplicate actions are removed by value, not by the Vessel's `idempotent` flag: a later action with the same instance, name and fully bound parameters as an earlier one is dropped and logged as `jev.duplicate_action_dropped`, so a parameterless view switch asked twice runs once while two `moveEvent` calls for different events both ship. The action limit counts the actions left after duplicates are dropped. An action with a `stated_elsewhere` parameter is kept, and both completion stages (`completeLayoutInline` and `completeLayoutParallel`, which share the step that builds the candidate) compare it once its values are filled: a repeat is left out of the execution plan, logged as `jev.duplicate_action_dropped`, and the declared variants are simulated from the actions kept. A parameter left unanswered by an action and its repeat is asked once; actions that differ in instance, name or bound parameters keep separate asks.

The per-instance stage trades against the state-keyed one:

- One call instead of two, at the cost of a larger question set: every candidate action's parameters are asked speculatively.
- Actions keep their order within an instance, but nothing orders actions across instances; instances are planned independently, so this is accepted.
- Slot 2 is answered without seeing slot 1's answer, since questions in one call are answered independently. The premise labels let code pick the matching branch and defer the rest, so a mismatch costs a fallback, not a wrong plan.
- At most two actions per instance are planned. A third requested action on one instance defers `jevActions/action_limit` to the fallback rather than shipping the first two on their own; slot 3's answers measure how often that happens.

The Phase 3 planners (`src/lib/planners-experimental/`) cross the two select stages with the three actions stages, all with `layoutPreset` in the POC's wording and `completeLayoutInline`; the gated arms take `actionsStepwiseGated` where the ungated ones take `actionsStepwise`: `jev-ungated-stepwise-preset-inline`, `jev-ungated-batched-preset-inline`, `jev-ungated-per-instance-preset-inline`, `jev-gated-stepwise-preset-inline` and `jev-gated-batched-preset-inline`.

The Phase 5 arms vary the layout and completion stages on `selectGated` and `actionsBatchedPerInstance`. Each is built by `buildJevStagePlanner` (`src/lib/planners/jev-stage-planner.ts`) from one stage factory per slot, so a further arm, such as the winning layout and completion stages on `actionsBatched`, is one entry in `eval/arms.ts`.

| Arm | Layout | Complete |
| --- | --- | --- |
| `jev-gated-per-instance-preset-inline` | `layoutPreset`, placements wording | `completeLayoutInline` |
| `jev-gated-per-instance-preset-or-llm-inline` | `layoutPresetOrLlm` | `completeLayoutInline` |
| `jev-gated-per-instance-preset-or-llm-parallel` | `layoutPresetOrLlm` | `completeLayoutParallel` |
| `jev-gated-per-instance-composed-pairs-gate-and-defer-inline` | `layoutComposedPairsGateAndDefer`, the stage eval's `composed-pairs` variant; built by `buildJevComposedPairsPlanner` | `completeLayoutInline` |
| `jev-ungated-per-instance-preset-or-llm-inline` | `layoutPresetOrLlm` (with `selectUngated`) | `completeLayoutInline` |

`jev-gated-per-instance-preset-inline` moved to the placements wording in Phase 5; its Phase 3 records used the POC's wording. There is no `preset-parallel` arm: the preset stage never hands off, so the parallel call would never run.

Phase 5 deleted the layout arms that lost, with their stages and stage eval variants. Their records under `tmp/` keep these names:

| Deleted arm | Why |
| --- | --- |
| `jev-gated-per-instance-spatial-gate-inline`, `-parallel` | Handing every stated arrangement to the LLM: 82.6% overall and 84.0% arrangement pass on the development suite (`phase5-one-factor`), 9 of 15 expected deferrals, 6 invalid LLM layouts. |
| `jev-gated-per-instance-always-llm-inline`, `-parallel` | The control, the LLM writes every layout: 88.9% overall, 90.7% arrangement, 9 of 15 expected deferrals, the slowest arm (p50 4.3 s, p95 10.1 s). |
| `jev-gated-per-instance-composed-inline`, `-parallel` | Shape, part and position answered independently, so they disagreed: 69 to 73% in the layout stage eval against 80% for the preset menu. |
| `jev-gated-per-instance-composed-2-size-levels-inline` | The same composed stage with 2 size levels: 77.1% overall and 69.3% arrangement pass live. |
| `jev-gated-per-instance-composed-pairs-inline`, `-parallel` | Superseded by the gate-and-defer arm, which adds pair questions on every turn and the deferral when nothing fits. |

### Composed pairs layouts

`layoutComposedPairsGateAndDefer` asks, in one call whenever 2 or more Instances are visible (whatever the spatial gate answered), where the request puts each unordered pair of visible Instances (`left_of`, `right_of`, `above`, `below` or `not_stated`, with whole-board phrases such as "stack them all" among the side options), how much of the Chart each Instance gets (a score over five levels), whether the request states each Instance's size within its row or column and what fraction of it, and whether the request splits the whole Chart side by side or stacked. Every question stands alone, so independent answers cannot contradict a shared shape.

Code lists every two-level tree of the visible Instances, plus trees kept from the current layout at any depth: the current tree itself, and the current tree with one visible Instance moved or added beside any node, so a nested layout survives and "the current layout plus a strip along one edge" is a candidate. It scores each by the log probability of the relations and the top-level direction it implies; on a tie a two-level tree ranks first. `not_stated` votes for the current tree's relation, or, when the direction answer changes the current top split, for the relation along that direction in the current order. That redirect is for requests about the whole board ("put them all in a row"): it is skipped when a visible Instance is new to the current tree, since the direction then places the new widget, and when a pair states, at 0.5 or more, a relation across the direction (`left_of` or `right_of` for stacked, `above` or `below` for side by side), since the direction then describes one widget or group. A pair stated along the direction still redirects. In a two-level tree, splits along the top axis are weighted by the whole-Chart size answers; inside a row or column, stated fractions are kept and the rest is split by whole-Chart shares. A kept tree keeps the current weights of the splits it copies, apart from stated fractions, and sizes its new splits by the size answers. The top three trees are tried in rank order: a tree that fits as sized is returned; one that does not gives way to a lower tree of the three that fits as sized and scores within 2 nats of it (`AS_SIZED_SCORE_MARGIN`), and otherwise is returned with shares raised to each minimum, or else with equal weights, before the next tree is tried. So a far worse tree never ships just because it fits without resizing. When nothing fits, the stage defers `jevLayout/no_feasible_layout`, so the fallback planner answers the turn. When the spatial gate says yes on a request with user intent text, the plan has no action, every pair and the direction answer `not_stated`, every Instance gets the same whole-Chart size level with no stated fraction of its row or column, and the picked tree places the Instances as the current one does (weights aside), the stage defers `jevLayout/spatial_not_stated` instead of shipping an unchanged board: the request asks for an arrangement the pair questions cannot express, such as "arrange everything in a 2x2 grid". A request that states a size, such as "make the weather bigger", still ships, and so does a Chart resize with no intent text, which the gate can read as spatial though it asks for no arrangement. More than 6 visible Instances hand the layout to the completion call. The stage returns a `pairwise` record (gating route, every answer, the checked candidates with the kind of each, the chosen one and any size fallback).

The stage eval measured it one fix at a time against a plain composed pairs stage before settling on this construction. Those step variants were deleted once the planner shipped; they live in git history at commit 3b48b730 (`layoutComposedPairsWithOptions` in `src/lib/stages-experimental/layout-composed-pairs.ts`, variants in `eval-stages/layout.ts`), and a variant must be rebuilt to test it again.

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

`dev-jev` is the demo's `dev` target with `MAELSTROM_PLANNER=jev` and server-key mode (`VITE_BROWSER_KEY_MODE=0`). `npx nx dev-jev-composed-pairs @maelstrom-co/demo` does the same with the experimental composed pairs planner. Add `JEV_LOG_REPLIES=1` to see raw Jev replies, each turn's request and the shipped result.

| Variable | Meaning |
| --- | --- |
| `MAELSTROM_PLANNER` | `llm` (default), `jev` (`jevPlanner`) or `jev-composed-pairs` (`jevComposedPairsPlanner`, experimental). Anything else fails startup. |
| `TYPESAFE_API_KEY` | TypeSafe key. Required for both Jev planners; server-side only and redacted from logs. |
| `JEV_MODEL` | Pinned Jev model, for example `jev-1.13.0`. Required for both Jev planners; `jev-latest` drifts. |
| `OPENAI_API_KEY` | Server OpenAI key for `llmComplete` and the fallback. Required for both Jev planners. |
| `JEV_LOG_REPLIES` | `1` logs every raw Jev reply as `jev.reply`, each turn's request as `jev.request` and the shipped result as `jev.result`. Off by default; local debugging only. |

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
| `jevSelect/scope_unsupported` | Jev judged the request unsupported, or, for the gated select stage, the `generatedContent` gate answered yes. When both gates answer yes, `scope_unsupported` wins over `screen_content_unavailable`. |
| `jevSelect/scope_ambiguous` | Jev judged the request ambiguous. |
| `jevSelect/screen_content_unavailable` | Gated select only: the `dependsOnScreen` gate judged the request needs content the user already has in a widget, which the request does not carry. |
| `jevActions/action_unsupported` | A requested action is not available. |
| `jevActions/action_limit` | Jev chose a fifth action. |
| `jevActions/simulation_failed`, `jevLayout/simulation_failed` | A planned action is not valid for its instance's simulated variant. |
| `jevLayout/no_feasible_layout` | No candidate layout fits the Chart and the minimum sizes. |
| `jevLayout/spatial_not_stated` | The spatial gate said yes on a request with intent text and no planned action, but no answer stated an arrangement or a size and the picked tree places the Instances as the current one does. |
| `jevLayout/layout_unavailable` | Jev judged an explicit spatial request impossible with the candidates. |
| `llmComplete/param_unfilled` | The LLM returned `null` or an unparsable value for a `stated_elsewhere` parameter. |
| `llmComplete/invalid_candidate` | Validation rejected the assembled candidate. |
| `llmComplete/retry_recommended` | Validation recommended a retry for the assembled candidate. |
| `jevActions/batch_cap` | Stage library only: not even the first batched question fits the question cap. |
| `jevActions/premise_mismatch` | Stage library only: a per-instance second action assumes a view the first action does not lead to. |
| `llmComplete/invalid_layout` | Stage library only: a tree the LLM wrote on a hand-off is malformed, leaves out or adds an Instance, or breaks a minimum size. |
| `<stage>/option_cap` | A question had more than 255 options. |
| `<stage>/provider_timeout` | A provider call took longer than its timeout (5 s by default). |
| `<stage>/provider_network` | A provider call failed to connect, or its reply body could not be read. |
| `<stage>/provider_http` | The provider answered with a non-2xx status. The `jev.provider_failure` warn line's `failure` carries the status and the provider's error type and code. |
| `<stage>/provider_invalid_reply` | The reply was too large, not JSON, or failed strict validation. The `jev.provider_failure` warn line's `failure` names the check that failed. |
| `<stage>/provider_refusal` | Decisions refused a question. TypeSafe never refuses. |
| `<stage>/low_confidence`, `<stage>/answer_missing` | Only with a confidence gate, or a reply missing a validated answer. |

`provider_*` deferrals also log `jev.provider_failure` at warn. A user cancellation is a `CancellationError`, and a provider failure inside `llmComplete` is a `ProviderError`; neither falls back, because the fallback would hit the same provider.

## Logs

- `jev.call` (debug): stage, model, question ids, latency, outcome and token usage of every provider call (TypeSafe Jev or OpenAI Decisions).
- `jev.provider_failure` (warn): stage, deferral reason and a short `detail` of every failed provider call. Every failure except a refusal adds `failure`, the typed failure the transport returned. On a timeout that is whatever the transport reported once it was aborted. The typed failure is `network`, `http` with the status and the error type and code from wherever that provider puts them in its error body (each kept only when it is a short identifier that does not contain the key), or `invalid_reply` with one reason tag (`oversize`, `malformed_json`, `wrong_type`, `out_of_range`, `missing_answer`, `key_mismatch`, `probability_sum`, `not_most_probable`, `model_echo`). It never holds free-form provider text such as an error message.
- `jev.answer` (debug): stage, question, choice and confidence of every answer read.
- `jev.reply` (debug, opt-in via `logReplies` / `JEV_LOG_REPLIES=1`): the state and questions sent (the user's words included) and the raw reply, as JSON, before validation, so an invalid reply is visible too.
- `jev.request` and `jev.result` (debug, same opt-in): the user's request at the start of each turn, and at the end the shipped candidate as JSON (reply text, layout tree, rationale) or the error tag. The candidate is the one from Jev or from the fallback, whichever ships.
- `jev.action_dropped` (info): an action dropped for a `not_stated` parameter.

## Evaluating

The full-planner eval (arms, replay, scorers, grader) and the stage evals live in `@maelstrom-co/evals` (`packages/evals/README.md`). They reach this package's stages, planners and test fixtures through the workspace-internal `@maelstrom-co/planner-jev/_internal` and `@maelstrom-co/planner-jev/_testing` subpaths, which are unsupported outside this repository.
