# Agent skill onboarding patterns

Research date: **2026-10-03**. Context7 supplied initial references for Mastra, Effect, and TanStack Intent. Findings below follow those references to first-party documentation and source. Recommendations are proposals, not implemented behavior.

## Comparative reference findings

### Mastra: One entry skill, local knowledge, visible feedback

Mastra places “Build with AI” directly on its Develop page. It documents `npx skills add mastra-ai/skills`, package-manager alternatives, and `npx skills update mastra`. It says `create mastra` installs skills automatically. This makes skills part of normal development rather than a separate documentation destination.[^mastra-develop]

Its first-party repository offers a main `mastra` skill and a separate Factory skill. The main skill, metadata version **2.2.0**, presents a question-to-reference table for setup, API lookup, errors, migrations, and CLI work. It prioritizes embedded package docs, then installed source/types, then remote docs. Remote documentation can be ahead of installed dependencies.[^mastra-skill]

Embedded knowledge lives in `node_modules/@mastra/*/dist/docs/`: `SKILL.md`, topic references, and `assets/SOURCE_MAP.json` mapping exports to installed files. The reference includes concrete lookup commands and a fallback when embedded docs are missing. This is a useful model for explaining Maelstrom’s existing package-owned guides.[^mastra-ai]

Mastra also exposes a `.well-known/skills/` index and documents installation from its website. Its README asks users to verify the intended agent with `skills list`, inspect referenced files, and distinguish copied-but-not-linked results from an active installation. This documents discovery infrastructure, not proof that every agent automatically invokes the skill.[^mastra-repo]

The Develop page connects guidance to an execution loop: run an agent through `mastra api`, then inspect traces. Separately, the AI reference describes `llms.txt` as a documentation index with per-page Markdown. It explicitly discourages the docs MCP server for everyday development in favor of skills, while retaining MCP-specific tools such as migration. These are distinct products, not interchangeable installation paths.[^mastra-develop][^mastra-ai]

### Effect: Verified first-party skills, with version caveats

**Effect does ship first-party skills.** `Effect-TS/skills` documents `npx skills add Effect-TS/skills` and lists `effect-ts` plus `effect-v3-to-v4`. The setup skill directs agents to installed `node_modules/effect/AGENTS.md` and source. At revision `2309e6f` (2026-08-27), it also proposes installing `effect@rc` and editing repository instructions. Those are upstream setup instructions, not actions taken during this research.[^effect-skills]

The published **`effect@4.0.0`** artifact contains `AGENTS.md` with topic links into packaged `ai-docs`; the source manifest includes both in its publish files. This confirms actual package delivery. However, the older setup skill’s `@rc` recommendation must not override a consumer’s chosen version.[^effect-package] Maelstrom already packages guides, but its current SDK guides are brief API pointers, not comparably detailed installed how-to/topic documentation. Richer package-owned task guidance is the substantive extension, not copying an already implemented packaging approach.[^maelstrom-react]

The migration skill is a separate bounded procedure. Its frontmatter contains `disable-model-invocation: true`; its workflow validates checkout origins/versions, searches a generated migration reference, escalates to topic guides and source, and reports typecheck/tests. This is an explicit-invocation signal in the artifact, not verified cross-agent enforcement.[^effect-migration]

Effect’s human docs distinguish Onboarding, Guides, and Reference, expose v3/v4 selection, and link an LLM-development guide and developer diagnostics. That navigation serves both newcomers and task-focused readers.[^effect-docs]

Do not attribute community integrations to Effect itself. For example, `joelhooks/effectts-skills` documents Pi context injection, `/effect:docs`, scaffolding tools, and its own references. These are features of that third-party repository, not the official skills.[^effect-community]

### TanStack Intent: A catalog and an explicit lifecycle

Intent **0.5.3** is confirmed published by the npm registry; its inspected source revision is `9e6e5ed8` (2026-10-03).[^intent-registry][^intent-install] Consumer setup adds Intent as a development dependency, commits the lockfile, and runs `intent install`. First-run setup reviews source permissions and writes managed agent guidance; it does not install the library’s SDK. Upstream `@latest` examples can differ from the lockfile-pinned CLI. Prefer a reviewed, pinned dependency and its local runner.[^intent-install]

`intent list` is a task catalog: package/source/version counts, descriptions, and runnable `<package>#<skill>` identities. `load` prints the matching installed `SKILL.md`; its source confirms JSON output with package version, path, and warnings. `--json` and `--debug` provide concrete discovery diagnostics.[^intent-list][^intent-load]

Intent distinguishes **available → permitted → loaded → delivered → activated → applied**. Discovery is not trust. Successful loading is not proof of agent receipt, task relevance, or compliance. Its default setup writes instructions to list/load; `--map` writes explicit task mappings.[^intent-trust][^intent-install]

Optional hooks add session catalogs and edit gates for supported agents. They observe list/load commands before completion and cannot prove success or correct use. Claude Code and Codex support project hooks; generic `AGENTS.md` agents receive guidance only. Treat hooks as a supported-agent enhancement, not a universal guarantee.[^intent-hooks]

## Transferable patterns

- Keep one obvious entry skill and expose its task routes to humans. Mastra’s reference table and Intent’s catalog make selection inspectable.[^mastra-skill][^intent-list]
- Separate stable workflow guidance from release-matched API knowledge. Both Mastra and Effect route to installed artifacts.[^mastra-skill][^effect-package]
- Document each lifecycle state with an observable check. Avoid the ambiguous promise “automatic skills.”[^intent-trust]
- Put setup, invocation, update, removal, and troubleshooting together. Use existing tools rather than adding another installer.[^mastra-repo][^intent-install]
- Show a first task and its feedback loop beside installation, not only a download link.[^mastra-develop]

## Recommended Maelstrom first-use journey

The current implementation already has a `maelstrom` router, seven procedures, package-owned guides, a generated self-contained ZIP, and lifecycle commands. The rendered page emphasizes manual extraction and demonstrates installing only debugging.[^maelstrom-skills][^maelstrom-page] Keep those delivery contracts; complete the human journey:

1. **Find it.** Link “Build with an agent” from the README, Quick Start, and an early, plainly named “Agent skills” sidebar item. Explain skills versus standalone prompts, package API guides, and remote documentation. Do not make MCP a prerequisite.
2. **Choose a task.** Render the existing seven-row task table on the page, with the router above it. Each row should show outcome, procedure name, copyable example request, installation choice, and expected verification. Keep voice visibly optional.[^maelstrom-skills]
3. **Install once in project scope.** Lead with explicit full-bundle selection through pinned Vercel Skills. Keep manual ZIP as fallback and repository scripts as checkout-only. Do not install from the authored GitHub tree: references are transformed during the build.[^maelstrom-skills]

   Supported full-bundle command; set `BUNDLE_URL` to a verified built ZIP URL:

   ```sh
   bunx skills@1.7.0 add "$BUNDLE_URL" --skill '*' --agent pi --copy --yes
   ```

   The parent tested this command shape against a locally built ZIP URL: all eight installed; Pi selected only entry plus React migration.[^parent-tests] The hosted `https://docs.maelstrom-ai.co/agents/skills/bundle.zip` remains untested with the new bundle and awaits deployment. Interactive agent/scope choices and default discovery/invocation remain untested. No new CLI is proposed.
4. **Verify discovery before work.** Provide a tool-specific checklist: selected agent/scope, visible `maelstrom` and procedure names, and readable bundled references. For example, `bunx skills@1.7.0 list --agent opencode` filters the installer inventory; also confirm the agent's own skill catalog.[^vercel] Show explicit natural-language invocation: “Use the `maelstrom` skill to inspect this app and plan one bounded integration. Do not edit files.” Do not publish universal slash syntax without agent-specific evidence.
5. **Connect installed SDK knowledge.** Intent discovers package guides, not the independent workflow ZIP. Recommend a reviewed, pinned `@tanstack/intent@0.5.3` development dependency and committed lockfile. Use the local runner for reproducible setup and diagnostics; `install` is interactive and writes files. Review generated guidance so it does not reintroduce `@latest` drift.[^intent-install][^intent-registry] Extend package-owned guides with setup, task examples, verification, and common errors.

   Supported identity from the existing package tree:[^maelstrom-react]

   ```sh
   ./node_modules/.bin/intent install
   ./node_modules/.bin/intent list --json
   ./node_modules/.bin/intent load @maelstrom-co/react#maelstrom-react-sdk --json
   ```

   Compare the reported version with the installed manifest. If unavailable, check dependencies, permissions/exclusions, workspace root, and guide files; inspect installed exports/types as the router already requires.[^intent-list][^maelstrom-skills]
6. **Run one safe first task.** Offer separate plan-only and authorized-implementation examples. Resolve the Quick Start mismatch: its “plan” label links to a canonical prompt that explicitly authorizes implementation.[^maelstrom-authorization] Expected evidence: one selected procedure, exact SDK versions, bounded candidate inventory, and no edits for plan-only work. Implementation additionally reports typecheck, tests, lint, UI evidence, and live Engine verification separately.
7. **Maintain and troubleshoot.** Show update/remove commands for each installation owner; never mix manual, Vercel Skills, and repository-installer ownership. Refresh with the original `add` command; remove debugging with `bunx skills@1.7.0 remove maelstrom-debugging`. Workflow-bundle updates and SDK/package-guide updates are independent. Put missing skill/reference, empty Intent catalog, version conflict, and agent-did-not-load cases beside verification.[^maelstrom-skills]

Ship these as one coherent documentation change, including task examples and first-use tests. Do not defer discovery verification after improving installation copy.

## Evidence gaps

- No installers or agent-config edits were executed in this research clone. Parent evidence covers explicit full-bundle flags against a local build, not hosted deployment, interactive choices, or default filesystem discovery/invocation.[^parent-tests]
- The parent reports five successful controlled trials with explicitly registered paths. That supports those tasks, not default discovery. Test hosted installation, explicit invocation, unprompted selection, missing procedure, and SDK upgrades separately.[^parent-tests]
- This dependency-free clone’s required `intent list` returned “No intent-enabled packages found.” That does not disprove published package guides. No matching local skill was available to load.
- `https://effect.website/llms.txt` returned 404 on the research date. Context7’s historical index is not proof of a current endpoint. No official Effect docs MCP was verified.
- The isolated research clone could not run Nx checks or Vale because dependencies/styles were absent. After integration, the main checkout passed uncached root typecheck/test/check. Its global Vale differs from the repository pin; verification uses a temporary Vale 3.18.0 without changing the global installation.

[^mastra-develop]: [Mastra Develop](https://mastra.ai/docs/develop), retrieved 2026-10-03.
[^mastra-skill]: [Mastra SKILL.md, 1ddd3219](https://github.com/mastra-ai/skills/blob/1ddd3219f44770f5b84d9930f99fccd6fd1890ed/skills/mastra/SKILL.md), revision dated 2026-09-24.
[^mastra-repo]: [Mastra skills README, same revision](https://github.com/mastra-ai/skills/blob/1ddd3219f44770f5b84d9930f99fccd6fd1890ed/README.md); [live discovery index](https://mastra.ai/.well-known/skills/index.json), retrieved 2026-10-03.
[^mastra-ai]: [Mastra Build with AI](https://mastra.ai/reference/build-with-ai), retrieved 2026-10-03; [embedded lookup source](https://github.com/mastra-ai/skills/blob/1ddd3219f44770f5b84d9930f99fccd6fd1890ed/skills/mastra/references/embedded-docs.md).
[^effect-skills]: [Official README](https://github.com/Effect-TS/skills/blob/2309e6f27d9955b434c0e3f394b945c136e89fd2/README.md) and [setup skill](https://github.com/Effect-TS/skills/blob/2309e6f27d9955b434c0e3f394b945c136e89fd2/skills/effect-ts/SKILL.md), revision dated 2026-08-27.
[^effect-package]: [Published effect@4.0.0/AGENTS.md](https://unpkg.com/effect@4.0.0/AGENTS.md); [manifest, a5b1d4e4](https://github.com/Effect-TS/effect/blob/a5b1d4e4cae01dbe30890d3796f846bda00ad2ae/packages/effect/package.json), revision dated 2026-10-03.
[^effect-migration]: [Official migration skill, 2309e6f2](https://github.com/Effect-TS/skills/blob/2309e6f27d9955b434c0e3f394b945c136e89fd2/skills/effect-v3-to-v4/SKILL.md).
[^effect-docs]: [Effect Getting Started](https://effect.website/docs/v3/getting-started), retrieved 2026-10-03.
[^effect-community]: [joelhooks/effectts-skills README](https://github.com/joelhooks/effectts-skills/blob/main/README.md), mutable source retrieved 2026-10-03.
[^intent-install]: [Intent consumer quick start](https://tanstack.com/intent/latest/docs/getting-started/quick-start-consumers); [install specification](https://github.com/TanStack/intent/blob/9e6e5ed8e03ae0f3e0be71cd764c9afb96aec67d/docs/cli/intent-install.md); [0.5.3 manifest](https://github.com/TanStack/intent/blob/9e6e5ed8e03ae0f3e0be71cd764c9afb96aec67d/packages/intent/package.json), retrieved 2026-10-03.
[^intent-list]: [Intent list specification, 9e6e5ed8](https://github.com/TanStack/intent/blob/9e6e5ed8e03ae0f3e0be71cd764c9afb96aec67d/docs/cli/intent-list.md).
[^intent-load]: [Load specification](https://github.com/TanStack/intent/blob/9e6e5ed8e03ae0f3e0be71cd764c9afb96aec67d/docs/cli/intent-load.md) and [implementation](https://github.com/TanStack/intent/blob/9e6e5ed8e03ae0f3e0be71cd764c9afb96aec67d/packages/intent/src/commands/load.ts), same revision.
[^intent-trust]: [Intent trust model, 9e6e5ed8](https://github.com/TanStack/intent/blob/9e6e5ed8e03ae0f3e0be71cd764c9afb96aec67d/docs/concepts/trust-model.md).
[^intent-hooks]: [Intent hooks specification, 9e6e5ed8](https://github.com/TanStack/intent/blob/9e6e5ed8e03ae0f3e0be71cd764c9afb96aec67d/docs/cli/intent-hooks.md).
[^maelstrom-skills]: [Maelstrom skills README](../../apps/docs/skills/README.md) and [router](../../apps/docs/skills/maelstrom/SKILL.md), locally inspected revision `8bfdcb09` (unpublished).
[^maelstrom-page]: [Rendered page source](../../apps/docs/src/pages/agents/skills/index.astro), locally inspected revision `8bfdcb09`.
[^maelstrom-react]: [React manifest](../../packages/react/package.json), [React guide](../../packages/react/skills/maelstrom-react-sdk/SKILL.md), and [client guide](../../packages/client/skills/maelstrom-client-sdk/SKILL.md), locally inspected revision `8bfdcb09`.
[^maelstrom-authorization]: [Quick Start](../../apps/docs/src/content/docs/getting-started/quick-start.mdx) and [onboarding prompt](../../apps/docs/prompts/library/maelstrom-project-onboarding.md), locally inspected revision `8bfdcb09`.
[^vercel]: [Vercel Skills v1.7.0 README](https://github.com/vercel-labs/skills/blob/v1.7.0/README.md), retrieved 2026-10-03.
[^intent-registry]: [npm registry latest metadata](https://registry.npmjs.org/@tanstack%2fintent/latest), retrieved 2026-10-03: `@tanstack/intent@0.5.3`.
[^parent-tests]: Parent session's review, supplied 2026-10-03: `bunx skills@1.7.0 add <local-built-ZIP-URL> --skill '*' --agent pi --copy --yes`; all eight installed; Pi selected only entry plus React migration. Research did not independently rerun these tests.
