# Jev integration feasibility

**A Jev-backed structured planner is feasible at the code-contract level. Model quality and performance remain unverified.** Removing the user reply
removes the text-generation requirement from the planner's output. It does
not turn Jev into a direct replacement for a TanStack AI text adapter.

This experiment answers a narrower question: can typed judgments produce
Maelstrom layouts and ordered actions using the existing Vessel catalog and
validators? The [captured report](evidence/report.html) demonstrates that path.
The [run guide](README.md) explains how to repeat it against Jev.

## What was established

The offline suite contains 28 hand-authored judgment scenarios. All passed:
19 produce plans and nine defer. These numbers measure the compiler and its
boundary handling, not Jev accuracy. No TypeSafe key was available. The live
command was attempted and stopped with `blocked_missing_key` before any call.

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

The experiment uses two bounded stages:

1. Jev selects instance presence, arrangement, a primary instance, and up to
   two ordered actions. Code checks whether the selected sequence is valid.
2. If those actions need parameters, Jev selects candidate values in a second
   request. Code copies the values and constructs the final plan.

Independent questions within each stage share one request. Stage two depends
on the selected actions and their simulated variants. This avoids asking for
every possible action's arguments speculatively.

The five-Vessel fixture produces 20 first-stage questions. Its largest Choice
has 67 options. The serialized first-stage payload is about 51 KB, before
adding the model field. These are measured payload sizes, not token estimates.
Actual token usage and latency require a live run.

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

The `scope` question asks whether the complete request fits the supported
operations. It can be wrong. In particular, only live cases can establish
whether Jev reliably rejects a request requiring more than two actions
instead of selecting only the first two.

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

Continue applying the layout before executing actions. The new-instance case
depends on that ordering. A deferred result must not apply half a plan.

### Measure before choosing a deployment policy

The live runner records raw state, questions, distributions, chosen values,
latency, model identifiers, and usage. It compares observable behavior with
independently authored expectations. It never sends fixture answers or scoring
rules to Jev.

The current cases are development cases, not held-out evidence. After the
first live run, use a separate set of actual requests to measure:

- Correct layouts and action parameters on supported requests.
- Incorrect plans accepted, including partial handling of compound requests.
- Useful coverage and deferral rate on representative traffic.
- End-to-end p50 and p95 latency, including both stages and any fallback.
- Total provider cost using verified account pricing.
- Stability across repeated runs and catalog changes.

Compare the same cases with the current engine before claiming a benefit.
No baseline comparison, model-quality result, latency improvement, or cost
saving was established in this checkout.

## Recommendation

Proceed to a live evaluation of the bounded planner. The most promising
initial scope is selecting existing instances, arranging them, changing
variants, and invoking actions with enum or extractable arguments.

Keep unsupported or uncertain requests as explicit deferrals while measuring
coverage. Removing the chat reply makes this design more plausible, but the
remaining investment is a plan compiler and candidate pipeline, not a model
configuration change.

## Verification record

- Passed: prototype type-check, Biome checks, and all 28 offline cases, using
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
- Untested: live Jev responses, quality, latency, pricing, and comparison with
  the current engine. The live command recorded the missing API key.
- Not applicable: docs-site build and sidebar registration. These are local
  experiment documents, not published site pages.

The generated HTML is excluded from Biome because it embeds bundled code.
The authored viewer, report generator, planner, and evaluator remain checked.

## Evidence and sources

- [Captured compiler report](evidence/report.html)
- [Captured summary and parameter audit](evidence/offline-summary.json)
- [Recorded live blocker](evidence/live-status.json)
- [Existing response processor](../../src/lib/response/response-processor.ts)
- [Existing action validator](../../src/lib/response/execution-plan/parse-execution-plan.ts)
- [Default history projection](../../src/lib/history/history-manager.ts)
- [Demo runtime option publication](../../../../apps/demo/src/components/vessel-option-sync.tsx)
- [TypeSafe HTTP contract](https://docs.typesafe.ai/api.md)
- [TypeSafe Choice guidance and option limit](https://docs.typesafe.ai/primitives/choice.md)
- [TypeSafe function-calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling.md)
