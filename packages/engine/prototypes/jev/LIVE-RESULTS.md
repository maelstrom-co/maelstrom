# Live Jev planning results

**The integration is feasible, but Jev is not ready to replace the default LLM.**
The final planner passed every development trial, then accepted eight wrong
layouts on fresh synthetic prompts and starting states.

## What ran

The study used the public demo Vessel definitions and TypeSafe's live API.
The first run requested `jev-latest`; every response reported `jev-1.13.0`.
Later runs pinned that identifier. The confidence cutoff was zero throughout.

Each development sweep repeated 24 cases three times. Two cases are handled
by deterministic resize logic, so six trials made no model call. Model-backed
results below exclude those trials. The additional set contained 16 cases,
each repeated three times, with no deterministic-only cases.

The additional cases were authored before their first live call. The planner
was frozen before that run and was not tuned on its failures. These are still
synthetic, developer-authored probes, not a production benchmark. Repeated
trials do not count as independent examples of generalization.

## Results across the designs

| Design and set | Correct model-backed outcomes | Incorrect accepted plans | Unnecessary deferrals | Model-backed p50 / p95 |
| --- | --- | --- | --- | --- |
| Initial two-stage design, development | 45/66 (68.2%) | 15/46 accepted | 6 | 434 / 787 ms |
| Counted changes, development | 52/66 (78.8%) | 0/37 accepted | 14 | 419 / 878 ms |
| Staged decisions, development | 66/66 (100%) | 0/51 accepted | 0 | 647 / 1,142 ms |
| Staged decisions, fresh cases | 39/48 (81.3%) | 8/32 accepted | 1 | 604 / 1,256 ms |

The eight incorrect accepted plans matter more than the headline 81.3%.
Only 24 of 32 accepted fresh-case plans were fully correct. All 15 expected
fresh-case deferrals worked. One request that should have produced a plan
was refused.

No transport or response-schema errors occurred in these four sweeps. The
final fresh-case command exited nonzero because nine semantic expectations
failed. Those failures are retained in the report and raw records.

A later lifecycle audit checked retention of every original hidden instance
across all four captures. It found no additional passing trial to reclassify.
The evaluator now checks that invariant for every planned case.

## Why the changes helped

The initial planner asked independent questions for final visibility and each
hypothetical new instance. It revealed unrelated hidden widgets, allocated
extra instances, and repeated a single action into the second action slot.

The second design asked for visibility changes with an unchanged default.
It asked for new-instance counts and an action count. That fixed many layout
errors, but action selection could still target an instance that another
question decided not to create.

The final design makes that dependency explicit:

1. Select layout changes and counts. Code allocates the instances.
2. Select actions using only those retained or allocated instances.
3. Select parameters for the selected actions.

The third stage adds a round trip, but reduces irrelevant options and output
distributions. Layout-only requests still use one call. Parameterless actions
use two; parameterized actions use three.

## What failed on fresh cases

- **Hide phrasing, 3/3 failures:** “Take the forecast off screen” left weather
  visible. The planner returned a valid no-op layout.
- **Calendar variant change, 2/3 failures:** the requested `showMonth` action
  was correct, but the planner also created another calendar instance.
- **Exclusive comparison, 3/3 failures:** both weather locations and action
  targets were correct, but the layout retained an unwanted visible calendar.
- **Two distinct task writes, 1/3 failures:** the scope question refused a
  request that fit the two-action limit.

These are semantic errors, so layout syntax checks and typed parameter
validation cannot detect them. There is no evidence here that a valid plan
schema alone is enough for deployment.

## What confidence can and cannot do

A retrospective cutoff of 0.6 would retain nine fresh-case plans, all correct,
out of 33 cases that should have produced a plan. The other 24 would need
fallback or deferral. At 0.5, one wrong plan would still be accepted.

This is a post-hoc analysis, not a calibrated production policy. The same
records were used to inspect the thresholds. A new evaluation set is needed
before choosing a cutoff. Fallback latency, cost, and correctness were not
measured.

## Latency and usage

Times cover the complete local planner call, including all API round trips,
validation, and compilation. They come from serial requests from one machine.
There is no control for provider load or cache behavior. The initial smoke
case is excluded from the table.

The table and rebuilt HTML reports exclude zero-call resize turns. Original
summary files retain the runner's initial inclusive timing measurements.

On the final development run, per-call p50 values were 335 ms for layout/count
selection, 326 ms for action selection, and 323 ms for parameter selection.
For accepted fresh-case plans, end-to-end p50 was 680 ms and p95 was 1,626 ms.

| Run | API calls | Input tokens | Output tokens |
| --- | --- | --- | --- |
| Initial development | 87 | 1,185,523 | 184,498 |
| Counted-change development | 83 | 1,269,301 | 175,981 |
| Staged development | 120 | 947,688 | 63,533 |
| Staged fresh cases | 85 | 675,268 | 46,029 |

The final development design consumed fewer tokens than the initial design,
despite more requests. This does not establish dollar savings: account pricing
was not verified. The current LLM engine was not benchmarked against this set.

## Integration recommendation

Use a shared structured planning interface with interchangeable LLM and Jev
implementations. Keep Jev opt-in and preserve an explicit deferred outcome.
The application can choose whether that outcome invokes an LLM fallback.

The integration plan should separate the interface work from Jev promotion.
It should retain the LLM default, test optional reply text across consumers,
preserve atomic layout-before-actions processing, and specify acceptance
criteria for model quality before changing deployment policy.

The [approved plan](../../../../docs/plans/jev-planner-integration.md) specifies
that interface and migration. Apnea's [final review](../../../../docs/plans/jev-planner-integration-review.md)
confirms the retry, fallback, budget, and compatibility decisions.

## Inspect or reproduce the evidence

- [Initial live report](evidence/live-initial/report.html)
- [Counted-change report](evidence/live-refined/report.html)
- [Final development report](evidence/live-staged/report.html)
- [Fresh-case report, including failures](evidence/live-holdout/report.html)
- [Analysis, including confidence sweeps](evidence/live-analysis.json)
- [Archive manifest and SHA-256 hashes](evidence/manifest.json)
- [Run instructions](README.md)

Each archived run directory contains its original summary, gzipped result
records, and gzipped full request/response traces. The archives contain
synthetic inputs and model outputs, not authorization headers or credentials.

To inspect the raw fresh-case results from the repository root:

```sh
gzip -dc packages/engine/prototypes/jev/evidence/live-holdout/results.json.gz
```

To recalculate the analysis after running the suites:

```sh
bun packages/engine/prototypes/jev/analyze.ts tmp/jev-prototype/live-staged tmp/jev-prototype/live-holdout
```
