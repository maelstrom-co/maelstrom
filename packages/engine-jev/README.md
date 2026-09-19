# @maelstrom-co/engine-jev

Experimental server-only TypeSafe Jev planner for Maelstrom tiling layouts.
The conventional LLM remains the default. Configure Jev explicitly through
`createJevPlanner(options): Planner` with strict finalization and zero repairs.

See [Configure a planner backend](https://docs.maelstrom-ai.co/guides/engine/planner-backends/)
for complete server examples, local demo setup, fallback, and rollback.

## Public surface

- `createJevPlanner` constructs the planner; it does not contact a provider at construction.
- `JevPlannerOptions` requires server `apiKey` and a pinned `model`.
  Optional `endpoint` defaults to `https://api.typesafe.ai/v1/systemone`.
  Only use a trusted endpoint: it receives the bearer credential.
- `JevFetch` describes the optional injected fetch transport for offline tests.
- `JevConfidencePolicy.minimum` optionally defers consumed judgments below
  a probability in `[0, 1]`. Omission accepts valid highest-probability choices.
  This gate is uncalibrated and is not an authorization or correctness check.

Jev depends on the engine's public planner contract and protocol. Engine,
protocol, client, React, and browser realtime packages do not depend on Jev.
Keep keys, provider questions, and raw responses on the server. The planner
returns no provider body or credential in its errors. Hosts must also redact
all configured fallback secrets from their loggers and outward errors.

## Calls and results

The first phase selects visibility and desired variants for individual instances.
New instances use an exclusive set per Vessel type: none, one view, or an explicit pair.
Code derives the visible count
and generates layout candidates for that selected set. The next phase chooses
among layouts that fit the declared minimum sizes and Chart dimensions.

The layout carries the selected variants, as required by the client rendering contract.
Action selection starts from those post-layout variants and chooses one legal content action
at a time, or `done`. Each selected action's parameters are resolved before the next
action choice. Later choices see complete earlier operations and their parameters.
There is no separate action-count prediction.
View-only transitions are represented by the layout, not redundant action calls.
An action that would leave the selected variant is not offered. Content actions must
be declared in the post-layout variant. Hidden retained instances can receive content edits.

Selection uses one call, layout at most one, up to four actions plus `done` at most
five, and parameter selection at most four. Budget eleven logical calls for a full
turn, or thirteen for the local demo with LLM fallback and one repair. Simple display-only
turns usually use three calls. Each request claims the shared engine budget before
fetching, with no refund after a call starts. There is no internal retry loop.

Resize-only requests preserve the current tiling tree and return no actions,
without provider work. Grid requests defer without provider work. Successful
candidates omit `userMessage` and `rationale`. The engine sends only finalized
plans and persists accepted history, which does not prove client execution.

Schema validation checks model metadata, usage, question IDs, selected choices,
probability keys, totals, and values. Malformed successful responses map to
`InvalidProviderResponseError`; HTTP and transport failures map to `ProviderError`.
Semantic deferrals and strict-invalid candidates map to `PlanningDeferredError`
after any configured fallback. Cancellation, timeout, and call-budget exhaustion
are terminal and never start fallback.

## Deferral diagnostics

The engine logs `planning.deferred` with the request ID, planner ID, semantic reason,
and bounded diagnostic detail. `scope: unsupported` means Jev declined the request
during view selection. `limit: missing_candidates` identifies a parameter
without selectable values. Other limit names identify candidate or layout bounds.
Semantic deferrals leave the Chart unchanged unless a configured fallback succeeds.

## Capability limits

These are implementation limits, not restrictions on other planners or the protocol:

- Tiling only; no grid placement or generated content.
- At most four actions per turn, and two new instances **per vessel** per turn.
- Arrangements: preserve, equal row, equal column, two-thirds focus, or 2–12 balanced rows.
  Preserve keeps an existing tree when visibility is unchanged. New arrangements
  do not solve arbitrary nesting or spatial constraints.
- Parameter sources: normalized declared/runtime enums, booleans, numeric
  literals, and quoted source strings from the latest user intent.
  Without quoted strings or a matching enum, Jev can select verbatim spans of up to
  eight words from requests of at most 32 words. Both `Set weather to "Tokyo"`
  and `Set weather to Tokyo` supply a string candidate. Longer requests need
  quoted values or enums. Missing required candidates cause deferral.
- Choice questions support at most 255 options; parameter candidate sets at
  most 253 values. Oversized candidate sets or unsupported split arrangements
  cause policy deferral rather than partial output.
- The optional confidence gate and inconsistent cross-stage choices can defer.
  Repair invocations defer because this implementation has no repair strategy.

Intent planning filters layouts using each visible variant's declared `minSize`,
in their selected variants. No feasible candidate produces a policy deferral, not a partial layout.
Resize-only turns still preserve their tree without reconciliation or provider calls.
These checks do not establish content readability or semantic correctness. A valid
empty plan can still misinterpret intent; strict finalization cannot detect that error.

## Historical evidence and promotion limits

The [offline evaluation and promotion gate](https://github.com/maelstrom-co/maelstrom/blob/main/docs/planner-evaluation.md)
separates deterministic integration checks from evidence for a deployment decision.
From a repository checkout with frozen dependencies installed, run:

```sh
bunx nx run @maelstrom-co/engine-jev:evaluate-offline --skip-nx-cache
```

The target builds dependencies and exercises both real planners through
`Engine.handle()` with scripted transports. It needs no provider credentials.
It writes JSON and a concise summary to the terminal. Expected negative cases
remain in the report; only regression mismatches produce exit code 1.
For machine-readable stdout after the dependency build, run
`bun packages/engine-jev/evaluation/cli.ts` from the repository root.
The CLI accepts no arguments and has no live mode.

The staged prototype, using `jev-1.13.0`, scored **66/66 model-backed development
outcomes** and **39/48 fresh outcomes**. Fresh trials included **eight incorrect
accepted layouts** and **one unnecessary deferral**. Actions and parameters
were correct in those eight wrong-layout plans; only 24 of 32 accepted fresh
plans were fully correct.

Recorded model-backed p50/p95 was **647/1,142 ms** on development and
**604/1,256 ms** on fresh cases, across plans and deferrals. These measurements
exclude deterministic zero-call resize turns. They cover the complete local
planner, including API round trips, validation, and compilation, from serial
requests on one machine without controlling provider load or caching.

The cases were synthetic developer-authored probes. Repeated trials are not
independent examples of generalization. They do not represent production traffic
or benchmark this package against the current LLM. Account pricing was not
verified; token counts establish neither dollar savings nor lower cost.
Fallback latency, cost, and correctness were not measured.

A retrospective `0.6` cutoff retained only **9/33** expected fresh plans. The
same records informed that analysis, so it is not a calibrated deployment policy.
The full [historical study and archived evidence](https://github.com/maelstrom-co/maelstrom/blob/main/packages/engine/prototypes/jev/LIVE-RESULTS.md)
preserve the failures and measurement scope. Offline compiler tests do not
measure live model accuracy.

Promotion requires separate evidence on representative, independently labeled
requests, the current LLM on identical snapshots, and thresholds set before
holdout results. The integration makes no default switch or performance claim.
The trusted local demo supports Jev; hosted BYOK remains OpenAI LLM-only.
