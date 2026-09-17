# Offline evaluation and the planner promotion gate

The offline evaluator verifies integration and scoring behavior. It does not
measure model quality. The conventional LLM remains the default, and Jev remains
an experimental, opt-in server planner.

This explanation is for maintainers interpreting evaluation reports or deciding
what evidence a rollout needs. The [package README](../packages/engine-jev/README.md#historical-evidence-and-promotion-limits)
contains the command. The [integration plan](plans/jev-planner-integration.md#phase-6--add-offline-parity-evaluation-and-a-separate-promotion-gate)
defines the shared contract and acceptance criteria.

## What the offline report establishes

Each case runs the real `createLlmPlanner` and `createJevPlanner` through
`createEngine().handle()`. The conventional planner uses a fake TanStack adapter.
Jev uses a scripted fetch transport. Both routes use strict finalization and
zero repairs. Fallback, when configured, uses the real conventional planner and
shares the operation call budget.

Both routes receive the same frozen request, declared enum values, and retained
history. The engine creates detached, frozen planning snapshots. The evaluator
compares those snapshots across backends and checks identity across fallback.
The follow-up case seeds one identical accepted text-free turn into each store.
The real history projection supplies structured context to Jev and conversation
context to the conventional planner.

Provider scripts and independent labels live in separate files under
`packages/engine-jev/evaluation/`. Labels and scoring rules never enter provider
state, questions, or prompts. Scripts contain predefined responses, including
deliberately wrong answers. They perform no inference. Tests inspect the
outgoing payloads and require both real provider paths to run.

The synthetic cases cover:

- Tiling, grid support differences, and deterministic resize.
- Preservation, hidden reuse, hiding versus deletion, and arrangement.
- New-instance actions, ordered variant transitions, enum values, and exact
  quoted source parameters.
- Text-free Jev responses and follow-up history.
- Strict rejection, ambiguity, missing candidates, and implementation limits.
- Cancellation, malformed responses, provider errors, shared call-budget
  exhaustion, and bounded fallback after deferral or strict rejection.

Every accepted outcome is scored after engine finalization. Layout comparison
includes tree structure, split axes and relative weights, retained identities,
Vessel types, and Variants. Instance-array order does not affect this score.
Grid comparison includes identities, positions, and sizes. Action comparison
checks target identity, action name, and sequence. Parameter comparison checks
exact values when action identities and order match. An action mismatch is not
also counted as a parameter mismatch. Missing presentation text is valid.

The scorer recognizes equivalent split weights but is not a general visual
equivalence solver. It does not run client action handlers or establish that a
plan rendered correctly. The corpus uses fixed instance names for reproducible
new-instance checks; it is not a general scorer for arbitrary generated IDs.

## How to read the measurements

The JSON contains per-backend summaries and per-case outcomes. Rows retain the
final response or terminal error tag, observed primary outcome, call counts,
history-write count, semantic mistakes, and regression mismatches.

| Field | Meaning | Limitation |
| --- | --- | --- |
| `incorrectAcceptedLayouts`, `incorrectAcceptedActions`, `incorrectAcceptedParameters` | Separate semantic errors in accepted plans | Includes deliberate wrong-answer probes |
| `usefulCoverage` | Correct accepted plans divided by cases labeled as requiring a plan | Synthetic corpus only; includes capability gaps and negative probes |
| `unnecessaryDeferrals` | Uncertain terminal deferrals on clear requests labeled as requiring a plan | Capability and candidate gaps have separate counts |
| `candidateGaps`, `capabilityDeferrals` | Missing required candidates and unsupported layout modes | Does not estimate production frequency |
| `providerFailures`, `malformedProviderResponses` | Terminal transport failures and invalid provider responses | Scripted faults, not provider reliability |
| `compilerFinalizerFailures` | Terminal compilation errors or strict invalid-plan rejection | Expected malformed-tree probes are not proof of an implementation bug |
| `primaryDeferrals`, `primaryProviderFailures`, `rejectedPrimaryCandidates` | Primary outcomes, including recovered cases | A recovered primary fault is separate from final accepted-plan quality |
| `fallbackOperations`, `fallbackCalls` | Fallback invocations and claimed provider calls | Budget exhaustion can prevent provider work |
| `logicalCalls` | Claimed conventional `chat()` invocations or Jev stage fetches | Does not count retries hidden inside a real adapter |
| `harnessTimingMs` | Nearest-rank p50/p95 of local engine and scripted transport time | Harness overhead only; includes zero-call, failed, and fallback cases |
| `models`, `cost` | Configured synthetic model IDs and explicitly unknown cost | Fake usage fields are validation data, not measured tokens or prices |

The report records zero live calls. Timing values vary with machine load; case
identities, labels, scripted choices, and expected outcomes are deterministic.
No provider credentials, live mode, model-latency estimate, or dollar estimate
is involved.

Exit code 0 means every outcome matches its regression expectation. It does not
mean every accepted plan was correct. The report deliberately retains incorrect
accepted layouts, actions, and parameters. Tests require the scorer to detect
those schema-valid mistakes. Replacing a wrong-answer probe with a correct
answer also fails the regression check because it removes that coverage.
Unexpected outcomes, changed call counts, snapshot mismatches, and incorrect
history writes produce exit code 1. Unsupported CLI arguments produce exit
code 2.

The [historical prototype evidence](../packages/engine/prototypes/jev/LIVE-RESULTS.md)
remains separate. Offline scripts neither replace its failures nor calibrate a
confidence threshold. Its synthetic development and fresh trials remain
regression evidence, not representative quality evidence.

## What a separate promotion decision requires

Product owners must approve a representative evaluation source, privacy review,
redaction policy, sample size, labeling ownership, and trace retention before
collecting promotion evidence. Independent reviewers must label the intended
observable behavior. Development cases and the final holdout must remain
separate. Neither implementation may receive labels in its provider inputs.

Measure the current conventional LLM and Jev on identical representative
request, enum, and retained-history snapshots. Record the model versions,
finalization policies, budgets, fallback configuration, and repeated-run results.
Include the full fallback operation in correctness, latency, and cost results.
Verify provider usage and account pricing before making cost claims.

Owners must set thresholds before seeing final holdout results for:

1. Incorrect accepted layouts, actions, and parameters.
2. Useful coverage and unnecessary deferrals.
3. Fallback rate and final outcomes after fallback.
4. End-to-end p50/p95 latency under the actual transport deadlines.
5. Verified cost per operation, including fallback and failed calls.
6. Stability across repeated runs and relevant traffic segments.

No numeric threshold is approved by this offline suite. Do not tune against
the final holdout or use a universal confidence cutoff as a correctness rule.
Promotion requires a separate owner decision after those measurements.

Rollout stays opt-in and small. Rollback changes local or server configuration
to the conventional LLM; it requires no client or history migration. The
[planner backend guide](https://docs.maelstrom-ai.co/guides/engine/planner-backends/)
describes configuration and rollback. Hosted BYOK remains LLM-only. Changing
the default requires separate approval; passing this target does not grant it.
