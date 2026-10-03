# Agent prompts and skills

## Why maintain a contract

Maelstrom asks an Engine to choose among developer-authored Vessels with declared Variants, Actions, descriptions, and sizing constraints. Coding agents need similarly explicit boundaries: inspect the repository, use observed behavior, preserve framework invariants, and verify a bounded result. A maintained canonical source keeps copied instructions aligned with the published docs and avoids authorizing a workflow different from its lead skill.

This document covers developer-facing prompts and skills. It does not define Maelstrom Engine prompts or propose changes to the runtime architecture.

## Three distinct concepts

1. **Engine prompts** guide the model operating inside Maelstrom. They are runtime configuration and remain outside this contract.
2. **Developer prompts** are complete, copyable instructions for a coding agent. Each is self-contained.
3. **Skills** are durable lead procedures for a task. A lead skill may direct the agent to supporting references conditionally; references are not assembled into standalone prompts.

## Current implementation

Canonical prompt bodies live only in [`apps/docs/prompts/library/`](../../apps/docs/prompts/library/). Each Markdown file contains validated YAML frontmatter and a complete body. The Astro content loader validates sources and refreshes the collection when files are added, changed, or removed. The docs publish a current prompt index and one page per stable ID. Prompt-page copy and download use the raw body, excluding frontmatter; downloads are named `<id>-v<version>.md`. The guide view may show explanatory text and expandable prompt source, but its copy control is bound to that prompt's body.

The canonical library currently contains 12 prompts: project onboarding, SDK scaffold, Vessel modeling, connector/auth, React inventory, React conversion, debugging, observability, state synchronization, testing, upgrade, and voice integration. The stable IDs and bodies in the source directory are authoritative; this document summarizes rather than reproduces them.

The prompt metadata has exactly `id`, `prompt_version`, and `compatibility.sdk`. IDs are stable across filename changes. The PR validator compares base and head sources by ID, rejects removals and version decreases, requires a higher version when an existing body changes, and requires new IDs to start at `0.1.0`. Metadata and body validation are separate from behavioral evaluation. SDK compatibility declarations are claims in prompt metadata, not proof that every matching SDK release has been evaluated.

Seven portable procedures are maintained under [`apps/docs/skills/`](../../apps/docs/skills/): project onboarding, Vessel modeling, React migration, debugging, observability, state synchronization, and voice integration. The `maelstrom` entry skill selects one procedure; each procedure points to conditional references. Skills and standalone prompts are separate artifacts and do not generate, version, or bundle one another. The docs build generates a revision-matched ZIP containing the skills Markdown tree plus read-only projections of the canonical voice architecture and ADRs.

Each distributed procedure is self-contained. The build follows relative Markdown links, projects required shared references into that procedure's `references/` directory, and rewrites links that previously crossed the skill boundary. Transitive references retain their relative layout, including the voice architecture and ADRs. Missing resources, dependencies outside the skill/shared-reference roots, and conflicting projected files fail the build. Authored shared references remain canonical; generated copies require no separate maintenance. The bundle retains the shared reference tree for complete-tree consumers. Individual installation uses a procedure directory from the generated bundle, rather than its unbuilt GitHub source directory.

The documentation UI places an AGENTS sidebar group immediately before Community, containing **Prompts library**, **SKILL**, and **Testing prompts and skills**. Guide pages use one summary per prompt; source and its Copy control appear only when expanded. The prompt detail page exposes the current Markdown source and body-only copy/download; the skills page links the build-matched bundle and source browsing. Presentation details belong to the docs components, not this document's older proposals.

The app-owned [evaluation CLI harness](../../apps/docs/prompts/evaluation/README.md) registers five initial cases: onboarding implementation, modeling read-only, paired React inventory/conversion, and evidence-bounded debugging. Read-only grading checks structured fixture evidence and zero changes but does not grade semantic correctness. Implementation grading runs protected-file/allowlist checks, local SDK checks, evaluator-owned UI behavior tests, and browser assertions, with deterministic good/bad calibration. Tool-enabled CLI execution on the trusted host is not an OS sandbox. Pi and Claude Code adapters are supported; OpenCode 1.18.32 uses a per-process primary-agent wildcard-deny profile; earlier smoke attempts using only a global child permission overlay are not evidence that this corrected profile works. The retained first attempts include failures and timeouts, not a blanket quality result. The [evaluation plan](./evaluation_plan.md) separates behavioral checks from live Engine/provider validation and records remaining gaps. The prompt/skill condition model, fixture controls, and limits are explained in the [prompt acceptance guide](../../apps/docs/prompts/acceptance/README.md) and the public [Testing prompts and skills](../../apps/docs/src/pages/agents/evaluations/index.astro) guide. Metadata/version checks, docs build checks, and presentation checks do not establish that an agent performs well on every task. Do not describe removed acceptance checklists or sample runs as shipped evidence. Hosted CI results are distinct from local source validation and depend on running against the intended PR revisions.

## Prompt and skill workflow contracts

Every prompt and lead skill should make its task boundary, required inspection/evidence, applicable Maelstrom invariants, expected result, authorization, and verification clear.

- **Plan-only:** requests a plan and stops after returning it; it does not edit code.
- **Implementation:** authorizes the specified implementation after repository inspection and defines scope and checks. It does not add another approval round unless the user or discovered facts introduce an unresolved scope decision.
- A skill follows the user's authorization. It does not turn a plan-only task into implementation or add approval to authorized implementation.

React migration has two distinct published prompt flows: [`maelstrom-react-inventory`](../../apps/docs/prompts/library/maelstrom-react-inventory.md) is plan-only; [`maelstrom-react-conversion`](../../apps/docs/prompts/library/maelstrom-react-conversion.md) supports bounded conversion after inspection under its stated authorization. The [`maelstrom-react-migration` lead skill](../../apps/docs/skills/maelstrom-react-migration/SKILL.md) guides the wider incremental workflow. Other playbook stages are not separate published prompt IDs unless present in the canonical library.

Skills identify supporting references with concrete triggers. References add domain detail; they are not hidden prompt dependencies or concatenated into copied prompt text. Skills do not inherit prompt versions or contain generated prompt bodies.

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

## Canonical prompt metadata and versioning

The source location is `apps/docs/prompts/library/<id>.md`. A file contains YAML frontmatter followed by one complete, standalone Markdown prompt. No other document should maintain a copy of that body. Human explanation, selection guidance, and examples belong in docs pages and should link to the canonical source or published page.

| Field | Requirement | Meaning |
| --- | --- | --- |
| `id` | Required lowercase kebab-case string, unique across the library | Stable identity independent of filename and display title. |
| `prompt_version` | Required stable semantic version (`MAJOR.MINOR.PATCH`) | Version of the complete Markdown body. New IDs start at `0.1.0`; existing prompts use a higher version when their body changes. |
| `compatibility.sdk` | Required non-empty mapping of SDK package names to semver ranges | Declared SDK compatibility, not a claim of behavioral evaluation. |

Unknown fields, malformed YAML, duplicate IDs, invalid types, missing fields, invalid semver/ranges, and an empty SDK mapping fail source validation. The body is all Markdown after frontmatter and includes a trailing newline. Copy/download excludes metadata and page explanation.

The PR check compares the exact base and head prompt sets and matches by stable ID, not filename. A rename with the same ID and unchanged body needs no body-version bump; a changed existing body requires a strictly higher version; decreases and removals fail. Compatibility-only metadata changes do not require a body-version bump. New IDs start at `0.1.0`. CI checks do not establish behavioral quality or SDK coverage.

## Verification boundaries

Use the repository's relevant checks for implementation changes. Prompt source validation and version comparison are distinct from Markdown/prose checks, docs presentation/build checks, and behavioral evaluation. The initial app-owned behavioral harness is implemented; semantic review, broader skill comparisons, and live-service validation remain pending. PR CI compares immutable base and head revisions with full checkout and non-persisted checkout credentials. A failed workspace command should be reported with its actual project and failure rather than attributed to prompt docs without evidence; hosted CI results may also depend on the user pushing the intended revisions. The current published contract does not include acceptance checklists, sample-run records, or acceptance materials.

## Scope boundaries

Do not expand prompt/skill maintenance into a skill orchestrator, prompt dependency system, public historical prompt hosting, or a separate release service. Canonical runtime/realtime architecture remains documented in its own pages and ADRs; this document links to that material rather than duplicating it.
