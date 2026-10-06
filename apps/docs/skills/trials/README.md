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
