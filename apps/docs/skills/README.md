# Maelstrom agent skills

This directory is the canonical Markdown source for Maelstrom coding-agent skills. The revision-matched consumer bundle is generated from this complete tree during the docs build and is available as a [direct ZIP download](https://docs.maelstrom-ai.co/agents/skills/bundle.zip) or from the [Agent Skills docs page](https://docs.maelstrom-ai.co/agents/skills/). The build copies each procedure's required shared references into its own directory and rewrites its links. Voice includes read-only projections of the canonical architecture and ADRs. Install from the generated bundle so these resources accompany the skill; GitHub source browsing exposes the authoring layout. The extracted files are plain Markdown and need no runtime package, registry, or repository checkout.

## Consumer entrypoint

Install the complete bundle in the selected tool's project-scoped skill directory, then invoke the `maelstrom` entry skill for any Maelstrom task. It inspects the task and installed package versions, selects exactly one procedure, and routes API-specific work to guides shipped inside the SDK packages. The entry skill remains useful before any SDK is installed. A standalone prompt can be used without a skill; skills do not assemble, modify, or supply prompt bodies. Follow the user's authorization: plan-only work stops at a plan, while explicitly authorized implementation proceeds after inspection unless inspection reveals a material unresolved decision.

### Install, discover, update, and remove

Start with [Build with an agent](https://docs.maelstrom-ai.co/agents/skills/) for installation, the task catalog, a safe first request, and troubleshooting. Install the generated complete bundle through the pinned Vercel Skills tool from your application directory. For Pi:

```sh
bunx skills@1.7.0 add https://docs.maelstrom-ai.co/agents/skills/bundle.zip --skill '*' --agent pi --copy
bunx skills@1.7.0 list --agent pi
```

Replace `pi` with `opencode` or `claude-code` for those tools. Pi uses `.pi/skills/`, OpenCode uses `.agents/skills/`, and Claude Code uses `.claude/skills/`. Restart or reload the coding agent and ask it to read the installed `maelstrom` entry skill. An installer listing is not proof of activation or correct application. No global install, SDK install, or provider key is required for a planning task.

For manual installation, extract the ZIP's `apps/docs/skills/` contents into the selected tool's project skill directory. Preserve the complete tree. Use whole generated procedure directories for individual copies; authored GitHub files do not include the build projections.

For an existing checkout of this repository, `bun run --cwd apps/docs skills:install` downloads and installs the bundle; run the same command with `skills:update` after obtaining a newer docs build. `bun run --cwd apps/docs skills:remove` removes only files recorded by that installer and leaves unrelated skill files intact. For a downloaded ZIP/manual installation, re-extract the newer complete bundle into the same tool-specific skills directory to update; remove the Maelstrom-owned skill directories and `references/` only when no other installed skill uses those references. Do not delete the entire skills directory. SDK updates are independent: update the desired `@maelstrom-co/*` dependency with the project's package manager, then reload the package-owned guide under `node_modules/@maelstrom-co/<package>/skills/`; do not update an SDK merely to update skills, or vice versa.

### Install one procedure

With Bun installed, run this from your application directory to install the debugging procedure through [Vercel Skills](https://github.com/vercel-labs/skills):

```sh
bunx skills@1.7.0 add https://docs.maelstrom-ai.co/agents/skills/bundle.zip --skill maelstrom-debugging
```

Choose your coding agent and project scope when prompted, then ask it to use `maelstrom-debugging`. Select another procedure with its name from the table below. Each generated procedure directory contains its required local references, including transitive references; copy the entire directory if installing manually. The shared sibling `references/` directory is retained for complete-bundle consumers, but individual procedures do not depend on it. The entry skill selects a procedure and asks for it to be installed when it is missing.

For an installation managed by Vercel Skills, rerun the same `add` command to refresh it from the current docs bundle. Use `bunx skills@1.7.0 remove maelstrom-debugging` to remove that skill through the same installer. Keep manual, Vercel Skills, and repository-installer ownership separate when updating or removing files.

| Task | Lead skill | Reference selection |
| --- | --- | --- |
| New integration or broad project orientation | [`maelstrom-project-onboarding/SKILL.md`](maelstrom-project-onboarding/SKILL.md) | Connector/auth only for custom transport or application authentication. |
| Select and model a user-visible capability as a Vessel | [`maelstrom-vessel-modeling/SKILL.md`](maelstrom-vessel-modeling/SKILL.md) | Actions/idempotence before exposing side effects or retry-sensitive operations. |
| Incrementally migrate an existing React capability | [`maelstrom-react-migration/SKILL.md`](maelstrom-react-migration/SKILL.md) | Vessel modeling for the selected contract; Actions/idempotence before exposing side effects or retry-sensitive operations; rollback before changing/removing the legacy path. |
| Diagnose an observed failure | [`maelstrom-debugging/SKILL.md`](maelstrom-debugging/SKILL.md) | Connector/auth for transport/auth evidence; state-sync for definition/update conflicts. |
| Add event reporting | [`maelstrom-observability/SKILL.md`](maelstrom-observability/SKILL.md) | Security before logging request data, credentials, or user content. |
| Update a Vessel definition or runtime state | [`maelstrom-state-sync/SKILL.md`](maelstrom-state-sync/SKILL.md) | Actions/idempotence if operations are added or removed. |
| Integrate voice when the product goal requires it | [`maelstrom-voice-integration/SKILL.md`](maelstrom-voice-integration/SKILL.md) | Browser/React, lifecycle/turn-taking, or deployment only for the selected concern; provider guidance only after selection. |

For a mixed request, use the lead matching its primary outcome; that skill may point to relevant references. These are task-selection conventions, not automated orchestration. When no task clearly matches, use the relevant standalone prompt or ask the user to narrow the task rather than loading several competing leads.

## Bundle inventory

Package-owned SDK guides include conditional task recipes under each guide's own `references/` directory. Those recipes use the owning installed manifest as the version authority. Their code examples are compile-checked against published declarations; live Engine, microphone, and provider checks remain separate. Use Intent from the consumer workspace to list/load installed package guides. Intent setup writes permissions and agent instructions, so review it before confirming.

The bundle starts from every Markdown file below this directory. This is the authored inventory; the build also generates procedure-local reference files and rewrites the distributed skill links:

```text
apps/docs/skills/
├── README.md
├── maelstrom/SKILL.md
├── maelstrom-project-onboarding/SKILL.md
├── maelstrom-project-onboarding/references/
│   ├── maelstrom-project-onboarding/references/connectors-and-auth.md
│   └── maelstrom-project-onboarding/references/vessel-modeling.md
├── maelstrom-vessel-modeling/SKILL.md
├── maelstrom-react-migration/SKILL.md
├── maelstrom-debugging/SKILL.md
├── maelstrom-observability/SKILL.md
├── maelstrom-state-sync/SKILL.md
├── maelstrom-voice-integration/SKILL.md
├── trials/README.md
└── references/
    ├── actions-and-idempotence.md
    ├── browser-react.md
    ├── connectors-and-auth.md
    ├── debugging-evidence.md
    ├── provider-deployment.md
    ├── rollback.md
    ├── security-and-telemetry.md
    ├── state-sync.md
    ├── vessel-modeling.md
    └── voice-lifecycle-and-turn-taking.md
```

The build-generated bundle also includes the exact canonical `docs/realtime-voice-architecture.md`, `docs/architecture.md`, and `docs/adr/0001`–`0003` Markdown under `references/canonical-voice/docs/` and `maelstrom-voice-integration/references/canonical-voice/docs/`; these files are projected read-only at build time, not maintained copies. Each `@maelstrom-co/*` SDK package ships its API guide under its own `skills/` directory. The owning installed package's `package.json` is the version authority; the guide does not duplicate a version field. Maelstrom-specific API names must still be verified against the consumer project's installed exports, declarations, source, tests, and version-specific provider documentation. The bundle does not imply that an API exists in every SDK version or that external provider documentation is version-matched. Voice references are optional and do not imply that a provider is selected or supported. No skill assumes repository-internal absolute paths, starts agents, or performs side effects without the task's authorization.

Representative task inputs and expected outcomes are in [`trials/README.md`](trials/README.md). These are structural routing scenarios, not completed model trials; behavioral compliance requires executing them with a named agent/runtime and reviewing its output and diff.
