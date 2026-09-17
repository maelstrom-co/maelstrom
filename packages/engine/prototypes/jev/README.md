# Run the Jev planning experiment

Run a throwaway planner that returns only `layout` and `executionPlan` for
[Maelstrom Vessels](https://docs.maelstrom-ai.co/understanding/vessel-state-machine/).
Read [the feasibility findings](FINDINGS.md) and [live results](LIVE-RESULTS.md)
for the integration assessment.
The [approved integration plan](../../../../docs/plans/jev-planner-integration.md)
defines the proposed shared API and implementation phases.

## Before you start

Use the repository root with Bun and the workspace dependencies installed.
Follow the [repository setup](../../../../CONTRIBUTING.md#getting-started) if needed.
No new dependency is required. The live path uses TypeSafe's HTTP API.

The offline run uses hand-authored model answers. It checks the compiler, not
Jev's language understanding. Live runs require `TYPESAFE_API_KEY` in the
environment or the repository's ignored `.env` file.

## Run the offline cases

1. Run the evaluator:

   ```sh
   bun --conditions=@maelstrom-co/source packages/engine/prototypes/jev/run.ts --offline --verify
   ```

2. Open `tmp/jev-prototype/offline/report.html` in a browser. The file is
   self-contained and works without a server.

3. Select **Create and configure another weather instance**, then select
   **Apply recorded plan**. The board gains `weather-jev-1`. The JSON shows
   an action targeting that same instance.

4. Select **Reject an impossible action order** and apply its result. The
   planner defers the request and leaves the starting board intact.

The evaluator prints **28/28 expectations passed**. The report explicitly
labels the answers as scripted. The free-play controls change only the preview.

## Run against Jev

Start with one case after setting `TYPESAFE_API_KEY`:

```sh
bun --conditions=@maelstrom-co/source packages/engine/prototypes/jev/run.ts --live --case enum-route --verify
```

Then run the language-understanding cases three times:

```sh
bun --conditions=@maelstrom-co/source packages/engine/prototypes/jev/run.ts --live --repeats 3 --verify
```

The live suite excludes four compiler-only checks. It includes
two deterministic resize cases, which make no API request. Each other case
makes at most three API requests. Each request has a 30-second timeout and no
automatic retry. Authentication, overload, and response-contract failures stop
the sweep instead of counting as model mistakes.

The default model is `jev-latest`. Pass `--model` to select a model available
to your account. The report records the model returned by the API for each call.
Use that identifier for subsequent comparisons when the provider supports it.

Run the frozen set of additional prompt and state cases with:

```sh
bun --conditions=@maelstrom-co/source packages/engine/prototypes/jev/run.ts --live --model jev-1.13.0 --suite holdout --repeats 3 --verify
```

These are synthetic probes. Their recorded failures are evidence, not an
invitation to change expectations until the suite passes.

Pass `--min-confidence 0.5` to explore deferral behavior. The default is zero
so this experiment does not impose an uncalibrated confidence cutoff.
Thresholds apply only to consumed answers. These development cases cannot
establish a production threshold.

## Inspect the output

Each run writes four files under `tmp/jev-prototype/offline/` or
`tmp/jev-prototype/live/`:

- `report.html`: interactive starting-state and result viewer.
- `summary.json`: outcomes, request budgets, parameter audit, and live metrics.
- `results.json`: per-case expected behavior, output, and recorded judgments.
- `traces.json`: complete request questions, candidate values, and provider answers.

Pass `--out <directory>` to retain multiple runs. The default directory is
overwritten on each run of that mode. The API key is not included in these files.
The supplied cases contain synthetic data and public demo definitions.

Offline latency, token usage, and cost are reported as unmeasured. Live runs
record end-to-end and per-call latency plus token usage. Dollar cost remains
unset because the runner has no verified account pricing.

If no key is available, the live command exits with code 2 and records
`blocked_missing_key` in `tmp/jev-prototype/live/summary.json`.
`--verify` exits nonzero when any case fails or the sweep is incomplete.

## Verify changes to the experiment

Run the configured checks without the Nx cache:

```sh
bunx nx run-many -t typecheck,test,check --projects=jev-prototype --skip-nx-cache
```

The `test` target runs both offline suites, totaling 44 cases. They assert observable
layout, identity retention, ordered actions, exact arguments, and deferrals.
They do not score a simulated model as if it were Jev.

## Next steps

- [Approved interchangeable-planner plan](../../../../docs/plans/jev-planner-integration.md)
- [Final Apnea review](../../../../docs/plans/jev-planner-integration-review.md)
- [Feasibility findings and remaining work](FINDINGS.md)
- [Live results and generalization failures](LIVE-RESULTS.md)
- [Captured live development report](evidence/live-staged/report.html)
- [Captured fresh-case report](evidence/live-holdout/report.html)
- [Captured offline report](evidence/report.html)
- [TypeSafe evaluation API](https://docs.typesafe.ai/api.md)
- [TypeSafe function-calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling.md)
