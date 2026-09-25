# Agentic documentation architecture

## Why this needs a contract

Maelstrom already asks an Engine to choose among developer-authored Vessels with declared Variants, Actions, descriptions, and sizing constraints. Coding agents need similarly explicit boundaries: inspect the repository, use observed behavior, preserve framework invariants, and verify a bounded result. Without a maintained source and clear task authority, a copied prompt can drift from its documentation or authorize a different workflow than its skill.

This proposal is for developer-facing prompts and skills. It does not change Maelstrom Engine prompts, implement prompt files, add a renderer, or establish docs infrastructure.

## Three distinct concepts

1. **Engine prompts** guide the model operating inside Maelstrom. They are runtime configuration and remain outside this proposal.
2. **Developer prompts** are complete, copyable instructions for a coding agent. Each prompt is self-contained.
3. **Skills** are durable lead procedures for a task. A skill can point the agent to supporting reference guides, but those guides do not get assembled into or appended to a standalone prompt.

## Decisions for the initial implementation

- Store exactly one canonical Markdown source file per complete prompt in `docs/prompts/library/`. The prompt body is all Markdown after YAML frontmatter. Copy and download include that entire body and exclude frontmatter. Explanations and editorial prose stay outside the canonical file.
- Give genuinely different instructions separate stable IDs and files. Do not generate short and extended projections from one prompt, and do not generate skills from prompts.
- Prompts stand alone: no prompt dependencies, shared-text assembly, transclusion, or dependency-resolution graph.
- Publish only stable prompts. Each has a stable `id`, a `prompt_version` starting at `1.0.0`, and `compatibility.sdk`. Experimental/draft prompts are not published. SDK prereleases match only when a compatibility range explicitly includes them.
- Version validation is merge-blocking. A prompt body change requires a higher prompt version. A filename rename alone does not require a bump when stable ID and body are unchanged.
- Publish the latest prompt set with the docs site. Do not publish public historical archives or version-addressable releases. Older versions remain in repository history. Show the current version outside the copyable body and include it in the download filename.
- Authorization depends on the task: a plan-only prompt stops after presenting its plan; an implementation prompt explicitly authorizes edits after inspection. Do not add a universal approval pause to implementation workflows.
- One lead skill owns each task. It guides the full workflow and names conditions for reading supporting guides. There is no requirement to discover or coordinate multiple skills for one task.
- Initial prompt acceptance is manual: run defined cases against sample projects, complete a written checklist, and record outcomes. Prompt metadata/version checks remain automated in CI. Automated behavioral evaluations are later work.

## Proposed rollout

| Phase | Deliverable | Acceptance |
| --- | --- | --- |
| P0 | Stable canonical prompt source contract; initial onboarding, component-modeling, and debugging prompts; docs display/copy/download; blocking metadata and version checks | Schema/version fixtures pass; reviewers manually run the selected sample cases and record checklist outcomes; published pages show source-body copy and versioned filenames. |
| P1 | SDK-use, connector/auth, event observability, state synchronization, testing, and upgrade prompts; lead skills for recurring workflows | Each task has one lead skill or a standalone prompt, the sample cases pass their written checks, and supporting-guide triggers are documented. |
| P2 (proposed) | More frameworks and tasks; automated behavioral evaluation | Automation follows experience with the manual acceptance cases; it does not replace the metadata/version CI gate. |

P0's minimum integration path should inspect the project, identify installed versions, wire a bounded integration, and verify an intent without exposing provider credentials in browser code. Prompt files, skill packages, a renderer, and CI are proposed work, not present implementation.

## Task taxonomy and ownership

Choose prompts and lead skills by developer task, not by documentation page. For each request select one lead skill when procedural guidance is useful; standalone prompts remain usable without a skill. The lead skill owns the complete procedure and decides when its supporting references are relevant.

| Developer task | Standalone prompt purpose | Lead skill | Supporting guide trigger |
| --- | --- | --- | --- |
| Onboarding / SDK scaffold | Inspect repository and plan or implement the smallest integration, as authorized by the chosen prompt | `maelstrom-project-onboarding` | Read connector/auth guide if configuring a custom connector or application authentication. |
| Vessel modeling | Select a user-visible capability and model evidence-backed Variants and Actions | `maelstrom-vessel-modeling` | Read Actions/idempotence guide before exposing side effects or retry-sensitive operations. |
| React migration | Migrate one selected capability incrementally, including authorized edits, tests, and rollback | `maelstrom-react-migration` | Read Vessel modeling guide before defining the Vessel; read rollback guide before changing/removing the legacy route. |
| Debugging | Classify a failure from observed state and evidence before diagnosing or editing | `maelstrom-debugging` | Read connector/auth guide for transport or authentication evidence; read state-sync guide for definition/update conflicts. |
| Event observability | Add focused event reporting | `maelstrom-observability` | Read security guidance before logging request data, credentials, or user content. |
| Runtime state synchronization | Choose the correct update path and handle conflicts | `maelstrom-state-sync` | Read Actions/idempotence guide when a changed definition adds/removes operations. |
| Voice integration (optional) | Integrate voice without moving orchestration away from the Engine | `maelstrom-voice-integration` | Read browser/React, lifecycle/turn-taking, or provider deployment guide only for the selected concern; consult provider-specific material only after provider and deployment are selected. |

A request that combines work should still have one lead skill; that skill can link to relevant references. This is procedural ownership, not a skill orchestrator or multi-skill discovery system.

### Choosing what becomes a Vessel

Do not convert every React component. Inventory user-visible capabilities and choose a unit the Engine can meaningfully select and present, grounded in observed behavior and a plausible user intent. Keep implementation details—buttons, badges, spinners—inside the capability unless they are independently meaningful to users and the Engine. A useful single-Variant Vessel with no Actions is valid. Do not invent states or Actions to make a component appear more agent-ready.

## Prompt and skill workflow contracts

Every prompt states its task boundary, required inspection/evidence, Maelstrom invariants, expected result, authorization, and verification. Inspection comes before editing in both workflow types.

- **Plan-only:** explicitly requests a plan and stops after returning it. It makes no code edits.
- **Implementation:** explicitly authorizes implementation after repository inspection and defines scope and checks. It proceeds without an additional approval round unless the user or discovered facts introduce an unresolved scope decision.
- A skill's lead procedure follows the task's authorization. It does not silently turn a plan-only prompt into implementation or add approval to an implementation prompt.

A migration inventory is plan-only. A component migration prompt can authorize edits after inspection. Keep the two tasks distinct; neither prompt's title or example may imply the other's permission.

Skills guide an end-to-end workflow and identify supporting references with concrete triggers. Reference guides add domain detail; they are not hidden prompt dependencies and are not concatenated into copied prompt text. A change to a reference is reviewed by its owning lead skill. Skills do not inherit a prompt's version, bundle prompt bodies, or imply generated prompts.

## Maelstrom invariants for prompts and skills

- Orchestrate developer-authored Vessels; do not substitute generated runtime JSX for registered capabilities.
- Treat Vessel, Variant, and Action descriptions as orchestration inputs.
- Model legal discrete user-visible states as Variants, and legal current-state operations as Actions.
- Do not casually mark side-effecting Actions idempotent.
- Keep provider credentials server-side; application authentication and authorization remain application-owned.
- Keep Connectors focused on transport and treat the client as owner of layout state.
- Use the correct update path for factory-declared and runtime-registered Vessels; handle update conflicts explicitly.
- Classify failures by their actual surface. `processIntent()` processing failures are reported in Maelstrom state, not by assuming its promise rejects.
- Use programmatic layout only when deterministic application control is intentional, such as tests or explicit resets.
- For voice, speech supplies natural-language intent and the Engine remains the planner using client-owned state. Separate browser/React UI, realtime session lifecycle and turn-taking, and server credentials/provider deployment. Turn mode is runtime-reported, not a fixed provider flag. See the [voice architecture](../realtime-voice-architecture.md) and its [provider taxonomy](../adr/0001-realtime-providers-come-in-two-kinds.md), [credential custody](../adr/0002-credential-custody-is-a-dependency-edge.md), and [turn-taking](../adr/0003-turn-taking-is-provider-neutral.md) decisions.

## Canonical prompt format and docs publication

The proposed canonical location is `docs/prompts/library/<id>.md`. A file contains YAML frontmatter followed by one complete, standalone Markdown prompt. No other document maintains a copy of that prompt body. Human explanation, selection guidance, and examples belong in architecture/docs pages and link to the canonical prompt.

The initial schema is deliberately small:

| Field | Type and requirement | Meaning |
| --- | --- | --- |
| `id` | Required string; lowercase kebab-case, unique across the library | Stable identity independent of file location and display title. |
| `prompt_version` | Required string; stable semantic version `MAJOR.MINOR.PATCH`, starting at `1.0.0` | Version of the complete Markdown body. Prerelease/build suffixes are not valid published prompt versions. |
| `compatibility` | Required mapping with exactly one required key, `sdk` | Compatibility claims for SDK packages used by the prompt. |
| `compatibility.sdk` | Required non-empty mapping from package-name strings to semver-range strings | SDK compatibility. A prerelease SDK version is compatible only if a declared range explicitly includes that prerelease. |

Unknown fields, malformed YAML, duplicate IDs, invalid types, missing fields, invalid semver/ranges, or an empty SDK mapping fail validation. Do not add `experimental`, `draft`, or `dependencies` metadata: unpublished drafts stay out of the published library, and prompt bodies cannot depend on other prompt files. SDK compatibility is not a claim that every matching SDK release has been evaluated.

### Proposed docs adapter

The basic publication plan is a build-time docs-content adapter that reads `docs/prompts/library/*.md`, validates frontmatter, and exposes one latest route per ID under `/agents/prompts/<id>/`. It renders the Markdown body and shows ID, prompt version, and SDK compatibility as separate page metadata. Docs navigation links to those routes. The approach is proposed; it does not require a runtime API or a separate release service.

The page's copy and download controls read the canonical source body, not rendered page DOM. Copy the complete Markdown body with its original content and a trailing newline; do not prepend title, URL, YAML, or page explanation. Download as `<id>-v<prompt_version>.md`, containing that same body. The ordinary docs site's page-copy button remains distinct and must not be reused for this body-only contract.

### Version and CI contract

The initial blocking check runs on pull requests. Compare the exact prompt files at the PR's target base commit with the proposed head revision; use the repository's checked-out PR base SHA, not a moving branch name. Parse/validate each side independently. Match files by stable `id`, never filename. A rename with the same ID and identical body needs no version bump; a changed body under an existing ID requires a strictly higher semantic version. A version decrease fails. Compatibility-only metadata changes do not require a body-version bump. A new ID must start at `1.0.0`. Removing an existing published ID fails and requires retaining it or handling its removal as an explicitly reviewed policy change rather than silently deleting it.

CI fails closed: if the PR base revision cannot be fetched/read or either revision cannot be parsed and validated, the check fails and blocks merge. The validator must not substitute an empty baseline. There is no dependency graph to resolve. The check is merge-blocking for malformed/invalid metadata and missing required version bumps, not a warning. This is a proposed prompt-specific check; it does not replace the existing docs build/link checks or manual behavioral acceptance.

## Illustrative canonical prompt

The following file is an example only. Its ID, path, and title agree. It authorizes implementation after inspection; it is not plan-only.

~~~markdown
---
id: maelstrom-react-component-to-vessel
prompt_version: 1.0.0
compatibility:
  sdk:
    "@maelstrom-co/react": ">=0.0.0 <0.1.0"
---

Inspect the target component, its callers, state, data flow, and tests before editing.

Inventory its existing user-visible capabilities. For each candidate, cite observed
behavior and a plausible user intent, then explain whether the Engine can meaningfully
select and present it as a unit. Keep implementation details inside their owning
capability unless independently meaningful to users and the Engine.

Select an evidence-backed capability. A single-Variant Vessel with no Actions is
valid; do not invent states or Actions. Treat descriptions as product behavior.

After inspection, implement the selected capability as a typed Vessel, preserving
existing React rendering where practical. Add coverage for its Variant/Action
boundaries and run the repository's relevant checks. Do not expose provider
credentials in browser code. Report changed files and verification results.
~~~

Copying this example file as a prompt copies only the body beginning “Inspect the target component”; the metadata is for the library and docs view. The example SDK range is illustrative, not a support or evaluation claim.

## Skills: Lead procedure and references

A proposed skills tree can group references with the lead procedure:

```plain
maelstrom-react-migration/
├── SKILL.md
└── references/
    ├── vessel-modeling.md
    ├── actions-and-idempotence.md
    ├── connectors-and-auth.md
    ├── state-sync.md
    ├── debugging.md
    └── rollback-checklist.md
```

The migration skill is the lead for a migration request. It reads the Vessel modeling guide before selecting a capability or defining its contract, reads Actions/idempotence guidance before exposing retry-sensitive operations, and reads rollback guidance before removing the legacy path. Other guides are conditional on the task; they are not all activated for every request. The lead skill owns edits to its supporting references. No skill is built from a prompt, carries an inherited prompt version, or bundles standalone prompt text.

A proposed optional `maelstrom-voice-integration` skill should similarly own concise workflow instructions and read separate browser/React UI, realtime lifecycle/turn-taking, and server deployment references only when needed. It should link to the canonical voice architecture/ADRs rather than copy evolving API details. It should not imply provider support before a provider and deployment are selected.

## Manual acceptance before behavioral automation

For initial acceptance, maintain a written checklist and record outcomes for each run. Run the cases against defined sample projects, with the named project snapshot, task input, prompt or lead-skill version, installed Maelstrom version, operator/date, and relevant command/output evidence recorded. Do not present illustrative samples as actual measurements or successful runs.

A case passes only when its observable checks all pass, no prohibited behavior occurs, and the recorded result includes enough evidence for another reviewer to reproduce or assess it. A failed or unrun check is not a pass. The sample-project set and checklist are proposed acceptance fixtures, not existing test infrastructure.

| Case | Sample project and task | Pass criteria |
| --- | --- | --- |
| Onboarding | Small React project without Maelstrom; request a minimal integration with implementation authorization | Agent inspects package/entrypoint first, identifies required setup, keeps credentials out of browser code, implements only the bounded path, and records relevant type/test results. |
| Vessel selection/modeling | Project with a multi-state orders panel and a simple weather card; ask to model both | Agent cites observed behavior and user intent, selects user-visible capabilities rather than every component, does not turn loading/spinner details into invented capabilities, and permits the weather card to remain a single-Variant/no-Action Vessel. |
| Migration authorization | Same existing UI, one plan-only task and one implementation task | Plan-only run makes no edits. Implementation run inspects first and proceeds with authorized bounded edits without demanding another approval; both report scope and evidence. |
| Side-effecting Action | Checkout sample with a submit-order handler | Agent identifies mutation/duplicate-execution risk, does not casually declare idempotence, preserves application validation/confirmation, and tests the defined boundary. |
| Runtime update | Plugin Vessel registered at runtime with a permission-driven action change | Agent uses the retained registration handle's update path and explicitly handles live Variant/action or in-flight conflicts; relevant tests/results are recorded. |
| Debugging | Sample integration with an intentionally documented connector failure and inspectable status/config | Agent records the observed state/configuration that distinguishes the failure before diagnosis, does not treat `processIntent()` non-rejection as success, and proposes or makes only the authorized smallest fix. |

For each case the record includes: fixture revision and setup; exact user input; prompt/skill ID and version; installed package versions; expected checks; actual observations; files changed; commands and outcomes; pass/fail/unrun status; and reviewer/date. Manual acceptance is not a claim that prompts are universally correct. Automated behavioral evaluation is proposed later; CI metadata/version validation stays automated from the initial library.

## Illustrative insertion and transcript

A documentation callout may explain when a prompt is useful and link to its canonical route. It must not maintain a second copy of the prompt body.

A debugging example should show evidence before diagnosis. The following values are illustrative, not actual measurements:

> **Developer:** The Chart renders, but submitting an intent does nothing. `await processIntent(text)` does not throw. Find the bug; don't rewrite the component.
>
> **Agent:** I will inspect connection and processing state, Provider errors, connector configuration, server logs, and Vessel render failures before diagnosing.
>
> **Illustrative observed evidence:** `connectionStatus` is `disconnected`; `connectionError` records a WebSocket connection failure to the configured old endpoint; `lastError` is empty; server logs contain no request for this attempt. These observations support a transport diagnosis, not an Engine or Vessel-render diagnosis.
>
> **Agent:** The evidence points to the connector endpoint. I will update that configuration only if implementation is authorized, preserve the existing Vessel, and verify reconnection without logging credentials or intent content.

If a real example does not contain the observations needed to distinguish failure surfaces, leave the diagnosis unresolved and request or collect the missing evidence. Never fill evidence gaps with a definite root cause.

## Security and scope boundaries

| Risk | Required behavior |
| --- | --- |
| Secrets/authentication | Never request or echo literal PATs/provider keys; use environment references and inspect changes for accidental leaks. Keep provider secrets server-side. |
| Side-effecting Actions | Classify mutation/retry risk before exposing them; preserve app validation and confirmation. |
| Live state/schema changes | Handle dropped-Variant/action and in-flight conflicts instead of forcing a replacement. |
| Migration/refactor | Preserve a rollback boundary during initial rollout; verify before removing the legacy route. |

Runtime Engine prompt customization remains a separate concern. Changing Engine prompt text is not the default fix for layout or behavior problems; follow its dedicated docs and the Vessel/programmatic-layout guidance.

## Proposed future work

The initial implementation can begin with a small stable library, a source-based docs adapter, a blocking metadata/version check, and manual sample-project acceptance. Broader framework recipes, behavioral automation, and additional lead skills remain proposed. Do not expand this work into a skill orchestrator, prompt dependency system, historical prompt hosting, or a release service.
