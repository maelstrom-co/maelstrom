# Do the Maelstrom skills help agents complete tasks?

The skills supported working consumer implementations. These trials did not
establish a consistent completion advantage over installed declarations and
ordinary documentation. Keep the skills as guidance; do not claim a measured
quality improvement or token saving from this sample.

## Experiment

Eight actual agent attempts formed four matched pairs: onboarding, React
migration, debugging, and optional voice integration. One consumer in each pair
had the workflow bundle and package-owned guides. The other had neither, but
retained the same public SDK runtime, declarations, and ordinary app documentation.

Each pair received the same task. Pi used `openai-codex/gpt-6.1-sol` with low
thinking. Agents discovered the project skills through normal startup; the task
named no skill and the invocation supplied no skill-registration flag. Successful
trace reads confirmed delivery of each treatment's matching workflow and SDK guide.

Source revision: `cea9b128502d`. Installed SDK version: `0.1.0-alpha.4`.
The trials used locally packed public packages rather than monorepo source imports.
The guides and declarations were available from the installed packages.

Independent acceptance checks exercised real SDK runtimes with deterministic
Connector and provider fakes. The evaluator wrote the checks before the model
attempts and withheld them from the agents. Typecheck, lint, and agent-authored
tests were separate completion requirements. The evaluator did not repair an
agent's implementation.

These were agent-to-code-to-functional-check trials. They did not exercise a live
Engine, real browser layout, microphone capture, audio, or a live voice provider.

## Observed outcomes

| Task | With skills | Without skills |
| --- | --- | --- |
| First Orders integration | Working pilot; types, lint, and six local tests pass | Same |
| React results migration | Eight functional checks pass; types and three local tests initially fail | Eight functional checks and local gates pass; supplied Connector is replaced |
| Debugging false success | Eleven independent checks and local gates pass | Same |
| Optional voice integration | Eight independent checks and local gates pass | Same |

### Onboarding

Both implementations used a stable configured SDK instance, a scoped Provider
and Chart, an Engine-selected renderer, and application-owned authorized data.
Both retained the legacy flag path and unrelated Support capability.

The original oracle recorded four passes and one failure for each arm. Its
authorization test skipped clicking a disabled button before connection, then
expected a renderer that had never been selected. A separately labeled diagnostic
waited for connection and the enabled button before clicking. Both outputs passed
all five diagnostic checks without implementation changes. The original outcomes
and oracle stayed intact.

The first diff artifact compared unequal snapshot scopes and incorrectly appeared
to remove configuration files. Full filesystem comparison confirmed that those
files were unchanged. The comparable source diff replaced that artifact for review.

### Migration

Both implementations retained filtering, application-owned data loads,
authorization, cancellation confirmation, non-idempotent mutation guards, and
runtime rollback. The treatment used unbranded strings in its seeded layout;
TypeScript rejected them. Its DOM tests also lacked `ResizeObserver`.

The guard blocked some reasonable shell forms. One matched follow-up per arm
named the permitted check commands and asked the agent to fix its own errors
and review the original requirements. It disclosed no oracle failures or repair
suggestions. The treatment then used branded ID constructors and fixed its test
setup. Both arms passed typecheck, lint, tests, and the unchanged functional oracle.
Those are follow-up results, not initial-pass successes.

The control retained its replacement offline Connector. The treatment preserved
the supplied dependency seam. This was a manual review finding: the oracle did
not assert that the flag-on Provider used that Connector. The task described a
dependency seam but did not directly require using it, so this difference provides
weak evidence of a quality advantage.

### Debugging

An invalid deterministic response made the real SDK reject `set_layout`.
`processIntent()` still resolved, and the original application reported success.
Both agents reproduced the failure, rejected an unrelated WebSocket observation,
and made the same bounded correction: await the processor's idle Result and
surface its Error through the existing application handler.

The independent oracle verified error reporting, later-request recovery, transport
failure, no implicit retry, and completion after a real asynchronous Action.
Both agents added a regression that rejected the original controller.

One additional treatment test used an unbounded microtask loop. It passed with
the repair but hung when the old controller was restored. The evaluator added
a process-group timeout to its mutation checks and preserved the agent output.
A separate regression failed on the original controller without relying on a
timeout. No additional model attempt occurred. This was a test-quality weakness
despite the correct runtime repair.

### Voice

Both implementations used the real realtime session and React extension with
a supplied deterministic adapter. They preserved text input, current application
authorization, captions separate from commands, runtime Turn Mode controls, and
session cleanup on stop, disable, and unmount.

Two post-hoc diagnostics supplemented the frozen oracle. Both outputs displayed
Orders after voice command dispatch. Only the treatment displayed an alert after
a rejected text intent. The control caught a promise rejection handled internally
by `processIntent()`; the treatment observed `lastError`. This is a verified
robustness difference, not a predeclared completion-rate improvement.

## Usage observations

| Task | Skills time | Control time | Skills estimated cost | Control estimated cost |
| --- | ---: | ---: | ---: | ---: |
| Onboarding | 274.571 s | 329.513 s | $0.225498 | $0.2724304 |
| Migration, initial | 128.187 s | 172.424 s | $0.093926 | $0.1239668 |
| Migration, follow-up | 82.999 s | 51.516 s | $0.089136 | $0.0430212 |
| Debugging | About 104 s | About 95 s | $0.070354 | $0.071624 |
| Voice | About 225 s | About 146 s | $0.29348 | $0.12504 |

Pi supplied the cost estimates; they are not billing records. Times include
different readiness boundaries, some runs overlapped, and command guards added
friction. These figures do not establish an efficiency advantage.

Token measures also need separate accounting for uncached input, output, cache
reads, and cache writes. Summing repeated context across turns is not the same
as measuring new task information. For example, onboarding's reported total
tokens were nearly equal despite the different cost estimates. No token-saving
percentage is established by these trials.

## Limits and next evaluation

There was one pair per scenario, one model, and one harness. Workflow and SDK
guides formed a combined treatment. These trials cannot isolate their separate
effects or estimate a general success rate.

The prompts gave detailed implementation and safety requirements. They therefore
provided part of the workflow guidance to the control. A repeated comparison
should use shorter outcome-based tasks and alternate arm order.

Onboarding's packing omitted ordinary package READMEs equally in both arms.
Migration needed a browser-platform setup correction after launch, although its
assertions remained unchanged. Together with the timing defect and Connector
coverage gap, these limit the acceptance evidence.

Dedicated Vessel modeling, state-sync, and observability tasks remain untested.
The local fixtures also do not establish hosted installation, live Engine quality,
or provider readiness.

The next repeatable migration evaluation should:

- Freeze a runnable negative fixture, independent oracle, and evaluator-only
  positive reference before agent execution.
- Preserve ordinary packaged documentation in both arms and remove only the
  baseline's workflow and SDK guides.
- Assert the supplied Connector seam, rollback, app ownership, and quality gates.
- Use bounded waits and cleanup so regressions fail instead of hanging.
- Record each quality result separately from validated model-usage totals.
- Leave savings unavailable when usage is missing or quality is not comparable.

These historical trials predate the updated React recipe. They do not verify
the new guidance through a model-backed run. The repeatable evaluator remains
separate draft work, outside the skills merge candidate.

## Security and evidence handling

During debugging-evaluator recovery, a broad process listing exposed an unrelated
database credential in tool-managed output. This violated the no-secret-output
requirement. Raw output, credential values, private log locations, and agent
profiles are not part of this repository record. Credential rotation remains an
operational follow-up, outside this repository change.

Future diagnostics must retain known child/process-group IDs and inspect only
those IDs without printing process arguments. Temporary Pi credential references
were removed after the original trials. No credential-backed model trial runs
as part of the premerge follow-up.

The structured companion [trial summary](agent-skill-task-completion-evaluation.json)
records curated outcomes, corrections, and usage estimates. The original raw
traces, snapshots, oracles, and source diffs were stored in private temporary
directories. A later harness restart removed those directories. This checked-in
summary preserves the historical observations, but it is not independently
reproducible evidence or a replacement for the lost traces.
