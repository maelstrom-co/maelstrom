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

The stages select layout/lifecycle changes, actions on retained or newly
allocated instances, then parameter candidates. Code owns instance allocation,
tree construction, candidate copying, and ordered variant simulation.

Layout-only requests use one logical fetch call. Parameterless actions use at
most two; parameterized actions use at most three. Each stage claims the shared
engine budget before fetching, with no refund after a call starts. There is no
internal retry loop. The engine controls finalization and optional fallback.

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

## Capability limits

These are implementation limits, not restrictions on other planners or the protocol:

- Tiling only; no grid placement or generated content.
- At most two actions per turn, and two new instances **per vessel** per turn.
- Arrangements: preserve, equal row, equal column, or two-thirds focus.
  Preserve keeps an existing tree when visibility is unchanged. New arrangements
  do not solve arbitrary nesting or spatial constraints.
- Parameter sources: normalized declared/runtime enums, booleans, numeric
  literals, and double-quoted source spans from the latest user intent.
  Without a matching enum, `Set weather to "Tokyo"` supplies a string candidate;
  unquoted `Tokyo` does not. Missing required candidates cause deferral.
- Choice questions support at most 255 options; parameter candidate sets at
  most 253 values. Oversized candidate sets or unsupported split arrangements
  cause policy deferral rather than partial output.
- The optional confidence gate and inconsistent cross-stage choices can defer.
  Repair invocations defer because this implementation has no repair strategy.

Tiling does not enforce vessel `minSize`. Structural validity does not establish
readability or semantic correctness. A valid empty plan can still misinterpret
intent; strict finalization cannot detect that semantic error.

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
