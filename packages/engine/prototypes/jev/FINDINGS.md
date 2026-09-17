# Jev integration feasibility

**Jev is feasible as an experimental, replaceable planner. The live results do not justify making it the default.** Removing the user reply
removes the text-generation requirement from the planner's output. It does
not turn Jev into a direct replacement for a TanStack AI text adapter.

This experiment answers a narrower question: can typed judgments produce
Maelstrom layouts and ordered actions using the existing Vessel catalog and
validators? The [live results](LIVE-RESULTS.md) demonstrate that path and its current limits.
The [run guide](README.md) explains how to repeat it against Jev.

## What was established

The current offline suites pass 28 development and 16 additional cases. They
measure the compiler, not Jev accuracy.

Live evaluation used `jev-1.13.0`. The initial design passed 45 of 66
model-backed development trials. Two revisions raised that to 66 of 66.
Six deterministic resize trials are excluded from those model totals.

The frozen additional prompt/state set passed 39 of 48 trials. It accepted
eight incorrect layouts and deferred one valid request. This generalization
gap is the main reason to keep the LLM default. See the [recorded live study](LIVE-RESULTS.md)
for latency, usage, individual failures, and preserved raw responses.

The planner returns exactly:

```ts
{
  layout: TilingLayout;
  executionPlan: readonly ActionExecution[];
}
```

There is no generated `userMessage` or `rationale`. Diagnostic metadata stays
outside the plan. The planner uses the real demo definitions for Calendar,
Weather, Tasks, Map, and Journal. The browser viewer shows schematic tiles,
not the demo's rendered components.

Verified offline behaviors include:

- Reuse a hidden instance instead of creating a duplicate.
- Hide an instance while retaining its state, or delete it explicitly.
- Compile equal rows, equal columns, and a weighted focus arrangement.
- Change variants through actions and resolve later actions against those transitions.
- Create an instance and target it in the same execution plan.
- Compare two subjects with distinct instances and correctly paired arguments.
- Select an enum argument or copy a quoted source value.
- Use structured prior plans as follow-up context without assistant prose.
- Preserve a tiling tree on resize without replaying a content mutation.
- Reject inconsistent choices before returning any partial plan.

The preview assumes successful action execution when displaying variant
transitions. It does not run action callbacks or prove their effects.

## Where the work moves

The final experiment uses three bounded stages:

1. Jev selects visibility changes, new-instance counts, an arrangement, and an
   action count. Code preserves unchanged instances and allocates new IDs.
2. When actions are needed, Jev selects them from the retained and created
   instances. Code checks the ordered sequence and simulates variants.
3. When parameters are needed, Jev selects their candidate values. Code copies
   those values and constructs the final plan.

Independent questions within a stage share one request. Later stages receive
earlier decisions as explicit state. This removed the competing hypothetical
instance targets that caused failures in the first designs.

Layout-only requests use one call. Parameterless actions use two calls.
Parameterized actions use three calls. The final development sweep measured
647 ms model-backed p50 and 1,142 ms p95 across plans and deferrals. These are
end-to-end times from this machine, not provider-only inference times.

Code owns instance IDs, action ordering validation, enum validation, tree
construction, and the decision to defer. Jev supplies semantic selections.
The first-stage questions cannot see one another's answers. Valid choices can
still disagree, so type-safe individual answers do not make the whole plan valid.

The experiment reuses these implementation points:

- `ChartRequestSchema` validates the input.
- `TilingLayoutSchema` brands and validates the constructed layout shape.
- `healTilingLayout` checks tree and instance coherence. A plan requiring repair
  is deferred rather than changed.
- `parseExecutionPlan` validates parameters and simulates sequential variants.
- The report uses the client's `parseTilingTree` and `computeTilingLayout`.

The layout healer currently accepts the wider `TilingResponse` type. The
prototype supplies empty text fields only to that local helper and ignores
its missing-rationale warning. Those fields are neither requested from Jev
nor returned in the plan.

## The strongest integration opportunity

Maelstrom already publishes useful candidate sets. `ActionParameter.enum`
describes closed-set values, and the demo's `VesselOptionSync` republishes
existing task, event, and journal titles as they change. Jev can use these
without a new protocol field.

The base-definition audit finds 34 parameter occurrences across variants:
five have enums and 29 are open. These are occurrences, not unique parameters
or a traffic-weighted estimate. Runtime option publication constrains more
of them. The `runtime-enum` case demonstrates an unquoted task title selected
from those published options.

Selecting an existing entity is therefore a better first target than creating
new content. The existing option-publishing mechanism is directly useful.

## The main limitation is candidate coverage

The prototype extracts double-quoted strings and numeric literals. It also
uses declared enums and boolean values. It cannot invent a value that is
missing from those sets.

For example, `Set weather to "Tokyo"` supplies a usable source candidate.
`Set weather to Tokyo` does not, with this extractor. The latter defers before
the argument call. This is a prototype extraction limitation, not evidence
that Jev cannot understand Tokyo.

Production coverage would need better source-span extraction, domain-specific
parsers, current entity catalogs, or a generative fallback. A request to write
new journal content can still require generation even when the engine does
not produce a chat reply.

Other explicit prototype bounds are:

- Tiling mode only. Grid placement is not implemented.
- At most two actions and two new candidate instances per Vessel per turn.
- Preserve, equal row, equal column, or two-thirds emphasis arrangements.
- No arbitrary nesting, arbitrary spatial ordering, or general constraint solver.
- Resize-only turns keep the tree and produce no actions; adaptive variant
  selection is not implemented.
- No fallback provider, repair loop, session persistence, or live client connector.

Maelstrom tiling intentionally does not enforce Variant `minSize`. This
experiment follows that contract. The narrow-Chart cases prove valid tree
construction, not content readability. Actual responsive UI quality needs
rendered Vessel evaluation.

The `scope` and action-count questions can be wrong. The first live design
proposed only two actions for one three-write request. The final design rejected every
over-limit request in both recorded sets, but this is not a guarantee for
unseen language or longer plans.

## What production integration would change

### Introduce a structured planning boundary

`EngineConfig.adapter` currently requires `AnyTextAdapter`.
`callLLM` sends prompts to `chat()` with a complete response schema.
Jev instead accepts state and typed questions at `/v1/systemone`.

Place a planning boundary before prompt construction. A Jev implementation
needs the structured `ChartRequest`, structured history, cancellation, and
diagnostics. The current text-adapter implementation can continue to build
its prompts inside that boundary. Request validation, deduplication, history
persistence, and final action/layout checks can remain shared.

A TanStack adapter that parses the engine's rendered prompts back into structured
state would hide the real integration work and couple Jev to prompt formatting.

### Make reply text optional through the actual contract

The isolated experiment already omits text. The production path does not:

- `GridResponseSchema` and `TilingResponseSchema` require text fields.
- `processResponse` rejects a missing or blank `userMessage`.
- `MaelstromResponse` and the transport schemas carry reply text.
- The default history projection reads the previous response's `userMessage`.

A real integration needs an explicit optional-message contract and consumers
that handle it. History should project previous intent, layout, and actions
when there is no reply. Chat display and speech consumers need corresponding
coverage. The experiment does not change that published contract.

The realtime seam already makes `SubmitIntentResult.userMessage` optional and
falls back to a settled UI summary. Reuse that behavior and test it through
the relaxed engine/wire contract; a new narration subsystem is not needed.

Continue applying the layout before executing actions. The new-instance case
depends on that ordering. A deferred result must not apply half a plan.

### Measure before choosing a deployment policy

The live runner records raw state, questions, distributions, chosen values,
latency, model identifiers, and usage. It compares observable behavior with
independently authored expectations. It never sends fixture answers or scoring
rules to Jev.

The additional cases were frozen before their first live run. They were
authored during this experiment and are not representative production traffic.
Use a separate set of actual requests to measure:

- Correct layouts and action parameters on supported requests.
- Incorrect plans accepted, including partial handling of compound requests.
- Useful coverage and deferral rate on representative traffic.
- End-to-end p50 and p95 latency, including every stage and any fallback.
- Total provider cost using verified account pricing.
- Stability across repeated runs and catalog changes.

Compare the same cases with the current engine before claiming a benefit.
No comparison with the existing LLM, latency improvement over it, or dollar
saving was established. The recorded live runs establish Jev behavior and
token usage on these synthetic cases only.

## Recommendation

Plan an opt-in Jev implementation behind a provider-neutral planning interface.
Keep the current LLM path as the default. Both implementations should emit the
same validated layout/action contract and support text-free responses.

Make promotion conditional on a representative evaluation set, incorrect-plan
rate, fallback coverage, and end-to-end cost and latency. The fresh-case
failures are layout judgments; action parameters were correct in the eight
accepted plans whose layouts failed. This makes bounded action routing a
promising scope for further evaluation.

The [integration plan](../../../../docs/plans/jev-planner-integration.md)
passed Apnea's review gate after three rounds. It preserves legacy LLM
healing and retry behavior, makes strictness explicit, and limits the first
Jev demo path to trusted local server configuration. See the
[final review](../../../../docs/plans/jev-planner-integration-review.md).

## Verification record

- Passed: prototype type-check, Biome checks, and all 44 offline cases, using
  `--skip-nx-cache` for the Nx targets.
- Passed: engine type-check, Biome checks, build, and 683 existing tests.
- Passed: root type-check, Biome checks, and both root test suites.
- Passed: dependency installation and the documented offline command in a
  fresh clone, without building the workspace packages first.
- Passed: report rendering, recorded-plan application, variant preview,
  deferral behavior, and free-play controls in Chrome. No console errors or
  warnings appeared. The report loaded without external network requests.
- Passed: local documentation links and terminal Markdown rendering.
- Passed: the two experiment pages under Vale 3.18.0, with no warnings.
  The repository documentation gate passed with existing warnings elsewhere.
- Measured: live Jev responses, quality on synthetic cases, latency, and usage.
  The fresh-case suite failed nine expectations; those failures are retained.
- Untested: account pricing, production traffic, and comparison with the current LLM.
- Not applicable: docs-site build and sidebar registration. These are local
  experiment documents, not published site pages.

The generated HTML is excluded from Biome because it embeds bundled code.
The authored viewer, report generator, planner, and evaluator remain checked.

## Evidence and sources

- [Captured compiler report](evidence/report.html)
- [Live results](LIVE-RESULTS.md)
- [Final live development report](evidence/live-staged/report.html)
- [Frozen fresh-case report](evidence/live-holdout/report.html)
- [Captured summary and parameter audit](evidence/offline-summary.json)
- [Initial missing-key record, superseded by the live runs](evidence/live-status.json)
- [Existing response processor](../../src/lib/response/response-processor.ts)
- [Existing action validator](../../src/lib/response/execution-plan/parse-execution-plan.ts)
- [Default history projection](../../src/lib/history/history-manager.ts)
- [Demo runtime option publication](../../../../apps/demo/src/components/vessel-option-sync.tsx)
- [TypeSafe HTTP contract](https://docs.typesafe.ai/api.md)
- [TypeSafe Choice guidance and option limit](https://docs.typesafe.ai/primitives/choice.md)
- [TypeSafe function-calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling.md)
