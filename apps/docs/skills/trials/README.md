# Maelstrom skill task trials

These are representative, reproducible task inputs for evaluating skill routing
and procedure quality. They are scenarios, not completed agent runs or claims of
behavioral success. Record the agent/runtime, installed SDK package versions,
loaded skill files, untouched task input, output, and observed repository diff
when executing a trial.

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
model-driven trials were not executed as part of this implementation.
