# Maelstrom skill task trials

These are representative, reproducible task inputs for evaluating skill routing
and procedure quality. They are scenarios, not completed agent runs or claims of
behavioral success. Record the agent/runtime, installed SDK package versions,
loaded skill files, untouched task input, output, and observed repository diff
when executing a trial.

Historical implementation findings are recorded separately in the repository's
`docs/research/agent-skill-task-completion-evaluation.md` and its structured JSON
companion. Those trials support local task completion, not a consistent quality
improvement or token saving over the baseline.

| Trial | Task input | Expected entry routing | Behavioral review focus |
| --- | --- | --- | --- |
| Onboarding | In a small React support app with no Maelstrom dependency, inspect the app and recommend one bounded capability for a first Maelstrom integration. Do not edit files. | `maelstrom` → `maelstrom-project-onboarding`; report no SDK guide because none is installed. | Repository inspection precedes API claims; no APIs are invented; plan-only request produces no edits. |
| Migration | This React app has a controlled search form whose network request and authorization are app-owned. Migrate only the results display to Maelstrom; preserve the form and do not send a request. | `maelstrom` → `maelstrom-react-migration`; load package-owned React guide only if installed. | Incremental boundary preserves app-owned behavior; no request is sent; API names are backed by the installed version. |
| Debugging | A redacted report shows a chart update followed by a transport timeout. Identify the failure layer and state the next evidence needed; do not change code. | `maelstrom` → `maelstrom-debugging`; load connector/auth reference only if evidence implicates it. | Distinguish observations from hypotheses; don't claim a root cause without evidence; plan-only means no edits. |

## Evidence levels

Automated tests in `apps/docs/tools/skills/skills.test.ts` establish structural
properties: archive/source parity, relative-link closure, package-guide version
metadata, install/update/remove behavior in an empty temporary project, and
expected routing text. They do not establish that an agent follows a procedure
correctly. Behavioral acceptance requires running each task input with a named
agent/model/runtime and inspecting its output and resulting project diff. Those
model-driven trials need separate execution and output review.

## Cold-start discovery checks

From a repository checkout on macOS with Pi already authenticated, run:

```sh
bun run --cwd apps/docs skills:acceptance
```

The optional runner installs all eight built workflow skills into fresh Pi
consumer projects. It uses normal project discovery, not explicit `--skill`
registration. Requests describe onboarding, migration, and optional voice without
naming a skill. The fixtures have no installed SDK; these checks cover workflow
selection and planning without fabricated API evidence, not SDK integration.

The runner verifies the startup catalog, successful workflow/reference reads,
matching task selection, and unchanged filesystem state. It blocks mutation tools
before execution and protects existing credential files with a macOS write-deny
sandbox. Authentication refresh is not authorized; authenticate separately if the
read-only readiness check fails. Timeouts terminate the spawned process group.

Logs and answers stay in a private temporary evidence directory. No credential
values are copied into the project or printed. Results deliberately label
application review as pending: inspect each answer for capability evidence,
missing SDK/version claims, ownership, rollback, undecided provider/deployment,
and honest unrun/live-check reporting before calling the behavior verified.

Use `MAELSTROM_SKILLS_MODEL=provider/model` to choose another available Pi model.
The default is `openai-codex/gpt-6.1-sol`. This is a tool-scoped acceptance check,
not a general OS sandbox or proof of universal agent activation.

## Task-completion comparisons

Discovery checks do not measure implementation quality. Compare two fresh
consumers with the same task, model, SDK, and ordinary documentation. Install
workflow and package-owned guides in one; remove both from the control. Keep
public runtime files and declarations identical. Use outcome-based requests
that leave the implementation procedure to the agent.

Freeze the runnable fixture, independent checks, and evaluator-only positive
reference before either agent starts. Keep those checks outside the agent's
consumer. The negative fixture must fail because the capability is missing;
the positive reference must pass the same checks. Include the supplied Connector
seam, application ownership, confirmation, rollback, and local quality gates.

Record functional checks, typecheck, lint, tests, and unchanged-file verification
separately. A guide read is exposure, not compliance. Preserve initial outcomes
when an agent receives a follow-up. Correct a defective oracle in a separately
labeled diagnostic rather than replacing the original result.

Keep uncached input, output, cache reads, cache writes, and estimated cost separate.
Missing or invalid usage is unavailable, not zero. Compare token use only when
the model, task, activation evidence, and quality outcomes are comparable.
Report cost as an estimate, not verified billing.

Use bounded test waits and per-test cleanup. For a stalled subprocess, inspect
only its retained PID or process-group ID; keep command arguments out of logs.
Store raw agent traces privately and keep credentials out of committed summaries.

### Repository migration evaluator

The repository's `skills:eval` command prepares and evaluates a matched migration
pair without launching a model or reading credentials. Use it from a repository
checkout after installing dependencies and building the React SDK and its
dependencies. It is not included as executable tooling in the downloadable skills
bundle. Preparation can fetch public dependencies.

Command shapes from the workspace root follow. Replace the bracketed arguments
with your paths and the seal returned by preparation:

```text
bun run --cwd apps/docs skills:eval prepare <new-directory>
bun run --cwd apps/docs skills:eval self-check <directory> <seal> --unsafe-execute
bun run --cwd apps/docs skills:eval evaluate <directory> <seal> --unsafe-execute [baseline.pi.jsonl treatment.pi.jsonl] [--review approval.review.json]
```

Preparation creates `baseline/`, `treatment/`, and `protected/`, then checks the
trusted negative fixture and private positive reference. Preserve the returned
seal outside agent access. Expose only the selected consumer to each external
agent, with the same outcome prompt. Make `protected/` inaccessible; it contains
the independent oracle, original snapshots, and positive reference. Stop both
agents before evaluation. A missing Pi trace leaves usage comparisons unavailable.

Keep the complete Pi JSON trace for each attempt, including its session directory,
user task, successful guide delivery, assistant usage, and final completion.
Use the unchanged `PROMPT.md` task in each consumer. Usage-only snippets or traces
from a different task cannot establish a comparable attempt. The evaluator also
checks added regression tests against the original missing integration; a passing
assertion that does not detect that missing behavior is insufficient.

Counterfactual assertion failures are provisional evidence. A source-text check
can fail against the original app without testing behavior. An independent
reviewer must inspect both submissions and their added tests before approving a
quality or token comparison. Approval must match the preparation seal and both
`hashes.submittedSource` values returned by evaluation. Missing, rejected, or
stale approval leaves normal attempts unapproved and savings unavailable.

The optional external approval file uses this shape. Replace the descriptive
values with the actual seal, source hashes, reviewer identifier, and assessments:

```json
{
  "version": 1,
  "seal": "prepare seal",
  "reviewer": { "id": "reviewer-01", "independent": true },
  "arms": {
    "baseline": {
      "sourceHash": "baseline hashes.submittedSource",
      "behaviorallyRelevant": true,
      "rationale": "Explain which added assertions exercise the missing integration."
    },
    "treatment": {
      "sourceHash": "treatment hashes.submittedSource",
      "behaviorallyRelevant": true,
      "rationale": "Explain which added assertions exercise the missing integration."
    }
  }
}
```

Keep approval outside agent access in a file ending in `.review.json`. The file
records a reviewer attestation; it does not authenticate the reviewer. Rationale
is not echoed. Comparisons additionally require completed task-bound traces,
no baseline guide exposure, and treatment delivery of both the migration workflow
and the installed React SDK guide. Uncached input, output, cache-read, and
cache-write differences remain separate; token differences are not billing.

Baseline exposure checks inspect plain system content and structured startup
sections against the sealed treatment guide fingerprints and skill catalog
identities. Ordinary SDK package-name mentions do not establish guide exposure.

Each native supervisor starts a separate process group. The caller retains its
group ID before publishing any ledger entry. Commands inherit that group, so a
supervisor crash or publication failure does not erase the cleanup target.
Cleanup kills that retained group and checks its absence within a bounded wait.
If verification fails, evaluation fails and preserves status and numeric identity
evidence. Inspect only those retained IDs; do not delete that evidence until
cleanup is verified. Code that creates another session can escape this group;
the runner is not a sandbox.

Evaluation executes submitted code. The explicit `--unsafe-execute` flag is
consent to that execution, not an isolation mechanism. Use a disposable,
externally isolated environment without secrets or live-service access. This
runner provides no filesystem or network sandbox and performs no model launch,
authentication refresh, credential rotation, or process-argument inspection.

Keep self-check output separate from model results. A passing positive reference
establishes that the checks can accept an implementation; it does not establish
that an agent can produce one.
