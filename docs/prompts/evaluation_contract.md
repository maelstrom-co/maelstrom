# Prompt and skill evaluation contract

Contributors use separate evidence for agent task completion, Engine integration,
and provider behavior. A result from one category does not establish another.
Use the [evaluation harness](../../apps/docs/prompts/evaluation/README.md) for
commands and the [trial guide](../../apps/docs/skills/trials/README.md) for matched
skill comparisons.

## Evidence labels

| Label | Required evidence |
| --- | --- |
| `mock` | A deterministic test double or fixed response; local handling only. |
| `simulated` | The fixture's simulated connector; observed client behavior, not Engine planning. |
| `Engine-live` | A named Engine deployment processed the request, with correlated response and rendered client state. |
| `provider-live` | An approved provider request or session; this alone does not prove Engine integration. |
| `Engine+provider-live` | The provider interaction and real Engine request are causally linked in the same trial. |

Unknown provenance is not live evidence. Record the deployment, model, fixture,
request correlation, and observed client state for each live claim. An Engine
using a mock model does not establish provider behavior.

## Behavioral checks

Pin the task, prompt ID/version/body hash, skill/reference hashes, SDK and fixture
versions, repository revision and dirty state, runner/model settings, and tool
policy. Record limits, retries, exit status, and evidence for each criterion.

Keep read-only inventory cases free of writes. Implementation cases must preserve
app-owned behavior and pass protected-file checks, the allowed-change rules,
SDK checks, independent behavior tests, and browser assertions. Calibrate graders
with known-good and deliberately broken candidates. Structural evidence checks
cannot establish semantic correctness; keep independent review explicit.

Use separate disposable projects for matched trials. Freeze the fixture and
independent checks before agents start. Record initial failures and supervised
repairs separately. Compare cost only when the model, task, activation evidence,
and quality outcomes are comparable. Report missing usage as unavailable.

## Execution and data boundaries

The CLI harness runs trusted-host code. A working directory and instructions do
not provide OS confinement. Keep controller credentials outside agent-visible
files and tools, disable agent-tool network access by default, and apply explicit
file, command, time, token, and cost limits. Model calls require their own approval;
they are not application provider-live evidence.

Live Engine or voice checks require a named non-production endpoint, harmless
fixture, reset owner, authentication procedure, provider configuration, budget,
call/session limits, and stop conditions. Keep browser grants separate from
server credentials as required by the [voice architecture](../realtime-voice-architecture.md).
Use only trial-owned processes and ports, and clean up only those processes.

Keep raw prompts, outputs, transcripts, screenshots, identifiers, and manifests
in access-controlled private storage outside the checkout. Retain sanitized
aggregate results only when their publication is approved. Never include
credentials. Deterministic checks may run in CI; live or model-driven evaluations
remain explicit opt-in. A synthetic pass does not authorize a live run.
