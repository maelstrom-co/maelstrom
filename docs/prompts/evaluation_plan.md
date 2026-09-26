# Prompt and skill evaluations

> **Status: Five-case registry, structured evidence grader, trusted SDK/browser candidate checks, and deterministic calibration are implemented; semantic review remains pending.** The app-owned harness registers onboarding implementation, modeling read-only, paired React inventory/conversion, and evidence-bounded debugging cases. Objective evidence checks, read-only zero-change enforcement, protected-file checks, SDK typecheck/UI tests, browser assertions, and good/bad candidate calibration do not establish semantic correctness or quality across prompts. The retained first-attempt outcomes include evidence-link failures and implementation timeouts; they were not retried. Read-only Pi cases use `--no-tools`; separately authorized implementation runs used trusted-host tools without OS confinement. No Engine or voice/provider service was contacted. User/global Pi settings still apply. See the [app-owned evaluator and current limits](../../apps/docs/prompts/evaluation/README.md).

## Why two tracks are needed

Metadata validation can confirm that prompt IDs, versions, and SDK compatibility declarations are well formed. Docs checks can confirm that the library renders. Neither shows whether an agent respects task authorization, produces correct SDK code, or drives a real Engine. Existing acceptance fixtures are useful controlled inputs, but their simulated connector returns a fixed response and never contacts an Engine. Treating that as live evidence would hide the most important integration boundary.

Keep behavioral correctness and service integration as separate tracks. First establish reproducible, credential-free behavioral checks; then validate actual Engine behavior against a disposable non-production deployment. Provider-live voice work is a later, separately approved tier. No track may infer evidence for another.

## Evaluation boundaries

Use these evidence labels in every result:

| Label | What ran | What it proves—and does not prove |
| --- | --- | --- |
| `mock` | A test double or fixed response | Local code handling only; no external service behavior. |
| `simulated` | The fixture's deterministic simulated connector | Client behavior against the fixture response; not Engine planning or provider behavior. |
| `Engine-live` | A real Engine deployment processed the chart request | Observed Engine integration for the named deployment and case; not a real voice-provider call unless separately labeled. An Engine using a mock model remains `Engine-live`, not `provider-live`. |
| `provider-live` | A real approved provider request/session occurred | Provider-path behavior only; does not prove the real Engine processed the resulting intent. |
| `Engine+provider-live` | Both the real provider path and real Engine request are causally observed for the same trial | End-to-end evidence for that trial and exact deployment/configuration only. |

A transcript, synthetic layout, browser render, successful socket connection, or provider response alone is not proof that a live Engine selected and applied a layout. Store explicit per-trial provenance showing which service processed which request. Unknown provenance is not live evidence.

## Track A: Behavioral evaluation

### Cases and order

The registry exposes the five cases listed below. Read-only cases grade process/transport, structured evidence dimensions, filesystem inspection, and zero changes; semantic review remains required. Onboarding and conversion use protected candidate baselines, an application-change allowlist with narrow generated-output exceptions, SDK typechecks, evaluator-owned behavior checks, browser assertions, and deterministic candidate calibration. These checks run trusted-host code and are not an OS sandbox. The table records behavioral criteria, not proof that every retained agent attempt passed. Do not broaden into all prompt/skill combinations until objective graders and the initial rubric are stable.

| Initial case | Prompt / fixture | Objective boundary |
| --- | --- | --- |
| Onboarding | `maelstrom-project-onboarding` / `onboarding-react` | Preserve the existing heading, explanatory copy, and ticket rows; implement only the bounded capability requested; SDK typecheck/tests pass; make no live claim. |
| Read-only inventory | `maelstrom-vessel-modeling` / `modeling-react` | Produce a grounded state/operation inventory and proposal; tracked diff is empty. |
| Authorization parity | `maelstrom-react-inventory` and `maelstrom-react-conversion` / identical migration fixture bytes | Inventory is plan-only and causes zero writes. Conversion may make only authorized capability/test edits and preserves controlled input, disabled empty submit, pending/error/success behavior, and the existing application-owned handler. No request is sent. |
| Evidence-bounded debugging | `maelstrom-debugging` / `debugging-react` | Separate observations from inference, cite supplied evidence, identify missing evidence, recommend only a bounded next diagnostic; no edits or unsupported root-cause claim. |

Once these checks have stable objective criteria, add the remaining prompt cases in batches: scaffold, connector/auth, observability, state sync, testing, upgrade, and voice integration. Record the batch and gaps; do not represent the initial suite as coverage of all 12 prompts.

### Selection, references, and execution are separate measurements

Evaluate skill selection independently from task performance:

1. **Routing:** Give a task and the published seven-skill index. Score whether the agent selects the single appropriate lead skill, or correctly selects none when no skill applies. Record competing/incorrect selections separately.
2. **Conditional reference use:** With the selected lead available, score whether it opens a supporting reference only when its documented trigger applies, and whether it avoids unrelated reference loading. References add domain detail; they are not hidden prompt dependencies.
3. **Execution:** Run matched cases in two arms: canonical prompt alone, and the same prompt plus the correctly selected lead skill and only references triggered by the task. Keep task text, fixture, permissions, model, and runner settings equal. Report the arms separately; never attribute a routing error to execution quality or vice versa.

For the first suite, assess routing for onboarding, modeling, migration, and debugging. Then execute the high-signal cases under both prompt-only and skill-assisted conditions. Do not compare prompt-only output from one model/runner to skill-assisted output from another and call the difference a skill effect.

Assemble the prompt body exactly as published; do not edit or append to it to inject skill content. Supply the canonical skill as a distinct input/instruction source in the runner. Record precisely how it was exposed and which references the agent actually accessed. Keep host/global agent configuration fixed and recorded; prevent machine-level instructions, untracked skills, and workspace-specific policies from silently leaking into one arm. If the runner cannot isolate or enumerate those inputs, mark the comparison inconclusive rather than claiming a causal skill effect.

### Objective grading

Use machine-checkable assertions wherever possible, followed by a human review for semantic claims. The evaluated agent must not grade itself.

- **Scope and authorization:** inspect the full scratch-project diff; require zero diff for read-only tasks, constrain conversion changes to named files/behavior, and fail on unapproved network calls, credential access, installs, or writes outside the case boundary.
- **SDK correctness:** run the case's actual baseline and relevant project typecheck/tests against pinned local SDK artifacts. A prose assertion that code is valid does not substitute for these checks.
- **Behavior and safety:** test declared Actions against the current state, including whether state transitions and duplicate/repeated execution respect the declared idempotence semantics. Check application-owned authorization boundaries and ensure provider credentials are not moved into browser code or fixtures.
- **Visible UI:** assert existing user-visible content and state transitions, and inspect actual rendered Vessel placement/size against the fixture Chart container where the case exercises geometry. Do not accept DOM text or a syntactically plausible layout as proof of correct geometry.
- **Grounding:** compare free-form plans and debugging claims to the fixture and cited source/evidence. A blinded reviewer applies a short rubric for unsupported claims, missing observations, and authorization violations; an LLM judge may assist triage but cannot override an objective failure.

Keep criteria atomic (pass/fail/unrun plus evidence pointer), not a single self-rated quality score. Report objective failures separately from subjective reviewer notes. Calibrate the semantic rubric on independently reviewed examples before using it for comparisons; document disagreements and adjudication without inventing a threshold from unrun cases.

### Reproducibility and isolation

For every trial, pin and record:

- repository revision and dirty state; stable prompt ID/version and canonical body hash;
- selected skill identity/revision and hashes of the skill plus every reference supplied or accessed;
- SDK package versions and source/build revision, lockfile/manifests, and fixture revision plus per-input hashes;
- exact task text, runner/runtime/tool versions, system/global instructions, model provider and model identifier, generation settings, tool definitions/policy, and deterministic seed if supported;
- network policy, filesystem roots, allowed commands, time/token limits, retries, exit status, and criterion evidence.

Separate the trusted runner controller from the agent's tool sandbox. Deterministic harness tests use a stubbed runner and require no model service. Actual coding-agent trials may use an approved model endpoint through the controller, with authentication kept outside agent-accessible files, environment variables, and tools. Approve the model-call budget before those trials, separately from Engine or voice testing. The network restriction applies to agent tools, not the controller's explicitly approved model transport. Calls powering the evaluated coding agent do not count as `provider-live` evidence for the application under test.

Run each agent trial in a fresh disposable project outside the workspace checkout, with no host credentials, bounded filesystem access, controlled process execution, and network disabled by default. Only explicitly allowlisted local package installation/build steps may be enabled during fixture preparation; agent execution itself must not gain arbitrary network access. Apply command, time, token, and file-write budgets and stop safely on limit. Use independent scratch state per trial; do not share caches or mutable files that can make one arm depend on another. Retain only controlled, sanitized artifacts and clean scratch projects after evidence has been extracted.

For nondeterministic model cases, use a preregistered repeat policy (initial proposal: three independent runs per arm), preserve each result, and report per-criterion counts and run-to-run variation. Do not average away safety or authorization failures. If the chosen service budget cannot support the proposed repeats, reduce scope with approval and label the evidence exploratory; never fabricate repeat results or treat a single lucky run as stable behavior.

### Proposed app-owned implementation shape

Keep modules owned by the docs application; do not add a package or runtime skill orchestrator. The implemented initial layout is `apps/docs/prompts/evaluation/` with a CLI, README, and deterministic fake-CLI tests. Suggested future files:

- `apps/docs/prompts/evaluation/cases/` — declarative case inputs and objective assertions referring to existing fixtures, not copies of canonical prompt bodies;
- `apps/docs/prompts/evaluation/runner.ts` — isolated trial invocation and input manifest;
- `apps/docs/prompts/evaluation/graders/` — deterministic diff, command-result, and rendered-behavior checks;
- `apps/docs/prompts/evaluation/README.md` — safe local invocation and evidence handling.

The runner should consume the canonical prompt/skill sources by stable ID/path and hash them at trial start. It should emit a sanitized summary and private evidence references, not commit raw conversations or trial bundles. The separate manual fixture bootstrap is `apps/docs/prompts/acceptance/prepare-trials.mjs`; it builds/packs/installs packages and creates transient trial artifacts, so it is not an evaluation runner and is not suitable for an unreviewed CI job. Its setup remains an explicit operator-run step, separate from evaluation.

## Track B: Engine and provider integration

The contract seam is `EngineConnector.process(message: ChartRequestMessage): Promise<MaelstromResponse>`. HTTP/WebSocket connectors and Engine construction/configuration are repository integration points, not evidence that a deployment endpoint exists. First define the exact non-production deployment and registered-Vessel fixture with the service owner; do not invent URL/env names or assume a managed endpoint.

### Tiers and checks

1. **Contract/mock baseline (credential-free).** Test request/response contracts and error handling with a deterministic local double. Label `mock`; use it to verify harness plumbing only.
2. **Live Engine, harmless app fixture.** Connect through a real supported HTTP/WebSocket connector to an explicitly approved isolated Engine deployment. Send an intent against a registered, harmless fixture Vessel and disposable chart/session. Capture request correlation and sanitized Engine response/provenance; assert the expected registered Vessel/layout selection, then assert that the client applies the layout and the rendered Vessel has the expected state and geometry in Chart coordinates. Exercise bounded error/timeout behavior. Do not use production data or execute business writes. If the Engine uses a mock model, report `Engine-live` and `provider-live: no` explicitly.
3. **Provider-live / voice, later and opt-in.** Once the Engine tier is understood and the provider path, objectives, and costs are approved, test one provider path separately. If voice is included, verify that speech supplies intent while the Engine remains the planner against client-owned state; record the runtime-reported Turn Mode rather than assuming a fixed mode. A successful provider conversation without a causally linked Engine request is only `provider-live`.

For voice, first follow [voice architecture](../realtime-voice-architecture.md) and [ADRs 0001](../adr/0001-realtime-providers-come-in-two-kinds.md), [0002](../adr/0002-credential-custody-is-a-dependency-edge.md), and [0003](../adr/0003-turn-taking-is-provider-neutral.md). Browser code may receive only an ephemeral provider-scoped Grant; long-lived provider secrets stay server-side. OpenAI Realtime and LiveKit cascade have distinct server/worker custody and setup. Do not merge them into one assumed configuration.

### Exact live prerequisites still requiring approval

The repository identifies `OPENAI_API_KEY` and `LIVEKIT_API_KEY` in `.env.example`; voice deployment documentation also identifies LiveKit URL/server-secret and worker credential requirements. These names do not establish a configured service or Engine URL, and no credential values were read. Before any external call, obtain and verify:

- an approved non-production Engine endpoint and deployment revision, its supported transport and authentication procedure, provider/model configuration, registered harmless fixture, disposable tenant/session, and an owner authorized to reset it;
- the selected provider path and exact provider/model/region, required server-side credential/grant flow, retention/logging constraints, and any separate LiveKit worker services if using cascade voice;
- a named approver for an explicit maximum spend, per-run and total call/session cap, runtime limit, retry policy, and stop condition;
- approved task/intent cases, observable expected outcomes, sanitization/retention destination, and permission to contact each endpoint.

Do not request or inspect secrets while planning. Do not place secrets in browser bundles, fixtures, task prompts, committed environment files, or PR output. If endpoint, custody, or budget is not settled, the live tier stays blocked; a synthetic success does not unblock it.

### Ports, artifacts, and failures

Use uniquely owned ports/processes for local clients; record ownership and clean up only processes started by the trial. Never stop or restart another user's server (including the known server on port 4322). Do not use a shared `BASE_URL` across multi-app gates. Preserve normal per-app endpoint configuration and fail closed if the expected local service is not the trial-owned process.

Keep raw prompts, model outputs, screenshots, transcripts, request payloads, and identifiers outside the PR in ignored scratch storage or approved private CI artifacts with access control, redaction, and retention limits. Never store secrets. PR-facing reports, if later approved, should contain harness/rubric changes and aggregate sanitized outcomes only—not raw trial records or historical QA run folders. Report first-attempt failures and any supervised repair/retry separately; do not replace the original outcome with the repaired pass.

## Phases and acceptance gates

| Phase | Work | Acceptance to proceed |
| --- | --- | --- |
| 0. Approve scope | Confirm runner/model, first behavioral cases, fixture revisions, and fixed host-policy/network controls. | Inputs and controls are written down; no service call required. |
| 1. Behavioral harness design | Specify case manifest, grader schema, scratch lifecycle, evidence handling, and deterministic checks for the four initial cases. | A reviewer can map each criterion to observable files, test output, or rendered state; plan-only cases demonstrably have zero-write criteria. |
| 2. Synthetic harness | Implement and exercise isolated cases with network disabled and no credentials. | Reproducible manifest; machine checks distinguish pass/fail/unrun; scope/auth failures cannot be overridden by prose or judge output. This remains `mock`/`simulated`. |
| 3. Skill comparison | Add routing/reference-access measurements and matched prompt-only versus skill-assisted arms. | Same pinned runner/model/task/fixture; prompt bodies unchanged; skill/reference hashes and access captured; results reported separately. |
| 4. Small-suite expansion | Add remaining canonical prompt cases and selected skills in batches. | Explicit coverage inventory and stable objective checks per case; no implication of universal prompt quality. |
| 5. Engine-live pilot | After live prerequisites are approved, connect one harmless fixture to one non-production Engine deployment. | Real deployment/request provenance plus observed registered-Vessel selection and client-applied rendered layout; budget, cleanup, and sanitized evidence verified. |
| 6. Optional provider/voice pilot | Separately approve and test one provider path, then voice if in scope. | Credential custody verified, spend/call caps enforced, runtime Turn Mode captured, and `Engine+provider-live` only when both sides are causally linked. |

CI rollout should begin with deterministic harness/schema/fixture tests only. Keep model evaluations and live Engine/provider jobs manual opt-in initially; do not immediately create a mandatory nondeterministic PR gate. Establish clean, correctly scoped workspace baselines before attributing failures to a prompt. Publish no quality claim until the corresponding case, revision, model/runner, and evidence are reviewable.

## Current decisions and remaining gates

- The installed `pi` CLI is the selected coding-agent runner and uses its existing configured model/provider; the harness does not force either. A hosted Engine is not required for this initial work.
- Current deterministic scope includes five registered cases, fake-CLI/process/evidence tests, SDK/browser candidate grading, and known-good/known-bad calibration. Authorized first-attempt Pi trials and SDK fixture preparation were run and retained separately; the implementation timeouts and evidence-link failures are not passes. No mass trial, model benchmark, skill comparison, Engine, or voice/provider service call has been run.
- The context-only read-only Pi adapter disables extensions, skills, prompt templates, themes, context files, and all tools (`--no-tools`); supplied fixture excerpts do not test repository-tool use or semantic quality. Tool-enabled implementation attempts require explicit operator approval or separately verified containment. Authorization on the trusted host is not OS confinement, and cwd alone is not confinement. User/global Pi settings still apply.
- Raw outputs/manifests are placed in a private user-selected directory outside the checkout. Do not retain them in the repository or report credentials.
- Remaining work includes independent semantic review of the retained five outcomes, skill routing/reference evaluation, and any future Engine-live/provider/voice work (each with separate evidence and approvals).

Existing workspace check failures must be rerun under correctly scoped commands before use as baselines; this plan does not claim the workspace is green.
