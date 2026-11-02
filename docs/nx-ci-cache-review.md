# Nx 24 CI and cache review

Reviewed on November 2, 2026 against fetched `main` at
`c570c66f7c79` (pull request #401). The manifest and installed CLI both use
Nx 24.0.2. This replaces the assessment made from the older Nx 23.3 checkout.
No CI configuration or Cloud settings were changed.

## Current configuration

The resolved Nx graph contains 33 projects. The main workflow runs every project
with `nx run-many -t check test build typecheck e2e`. It already configures base
and head SHAs through `nx-set-shas`.

| Target | Total | With `cache: true` | Without `cache: true` |
| --- | ---: | ---: | ---: |
| check | 33 | 31 | 2 |
| test | 31 | 0 | 31 |
| build | 29 | 27 | 2 |
| typecheck | 33 | 5 | 28 |
| e2e | 3 | 3 | 0 |

These are resolved target settings, not observed CI cache hit rates. The
uncached checks belong to the offline and Langfuse evaluation tools.

Nx Cloud is configured. Trusted CI runs use one four-CPU Blacksmith runner;
forks use a GitHub-hosted runner with Cloud disabled. The workflow does not
start distributed Nx Cloud Workers.

## 1. Use Nx 24 task-based affected selection

The current `nx.json` contains no `affected.legacy: true`, so the task-based
selection is already the default when calling `nx affected`. There is no Nx 23
opt-in flag to add. CI must use the affected command to gain its benefits.
[Nx 24 release](https://nx.dev/blog/nx-24-release)

The proposed command, after the input and artifact audit, is:

```sh
bunx nx affected -t check test build typecheck e2e
```

A graph-only comparison simulated changing
`packages/protocol/src/lib/brand-distinctness.test.ts`:

| Task selection | Full run | Affected run |
| --- | ---: | ---: |
| All tasks, including prerequisites | 135 | 105 |
| check | 33 | 27 |
| test | 31 | 26 |
| build | 29 | 26 |
| typecheck | 33 | 25 |
| e2e | 3 | 0 |

This removes 30 tasks, or about 22% of the graph. It is not a measured duration
improvement. Broad inputs and typechecks that depend on their own build keep
many builds in the affected run.

Before changing CI, declare the inputs of every task that reads dependency code.
`dependsOn` controls task ordering but does not propagate affected status.
[Affected tasks](https://nx.dev/docs/features/ci-features/affected)

Preserve the standalone validation steps after the Nx run:

- SDK validation reads runtime files in every published package's `dist`.
- Starter verification packages docs starter sources, then installs and checks
  the result as a standalone consumer.
- Docs link validation reads `apps/docs/dist`.

The simulated affected run omits `docs:build`. A direct command replacement would
leave the unconditional link check without its required output on a fresh
runner. Model these validations as Nx targets with correct inputs and build
prerequisites where required, or explicitly retain the required builds. Keep dependency
advisory checks, prompt policy, and full-corpus prose validation covered.

## 2. Enable caching for eligible tests and typechecks

Audit the 31 uncached test targets and 28 uncached typecheck targets. Enable
caching for deterministic targets after declaring their actual file,
environment, runtime, and generated-output dependencies. Include Bun's version
where test behavior depends on it. Keep live provider evaluations uncached.

Verify both cache reuse and invalidation after a dependency source edit.
Restore generated declarations and TypeScript build information where consumers
need them. Explicit project input lists override target defaults.
[Task caching](https://nx.dev/docs/features/cache-task-results)

## 3. Reduce unnecessary invalidation

The Biome plugin hashes `default` and `^default`, although its command checks only
the project's own directory. Audit whether dependency source is required. The
root Biome target also checks the whole workspace, overlapping project checks.
Narrow it only after preserving files outside project directories.

Most typechecks depend on their own build. Review which actually need generated
build outputs. Docs builds intentionally include `GITHUB_SHA` for source links,
so their output changes on each CI commit. Keep those links correct when
evaluating cache reuse.

Dependency-sensitive lockfile selection is another candidate through
`pluginsConfig["@nx/js"].projectsAffectedByDependencyUpdates: "auto"`. Validate
Bun catalog and override changes before adopting it. Targets that explicitly
hash the entire root manifest or lockfile will still invalidate broadly.
[nx.json reference](https://nx.dev/docs/reference/nx-json)

## 4. Trial Workers before Ultracache and dynamic task packing

Ultracache records file reads only on Nx Cloud Workers. Ordinary CI machines
can consume recordings but cannot create them. The current Blacksmith-only
workflow needs a Worker trial to assess this feature. All Cloud plans include
it, and declared outputs still control which artifacts are restored.
[Ultracache](https://nx.dev/docs/features/ci-features/remote-cache)

On Nx 24, CI uses Ultracache by default once the workspace setting is enabled.
Do not add `NX_CLOUD_USE_ULTRACACHE=true` to this workflow without a deliberate
trial: explicit opt-in makes unavailable or incomplete recording reports fatal.
The default behavior allows fallback to declared inputs.
[Version behavior](https://nx.dev/docs/kb/ultracache-nx-versions)

Dynamic task packing also needs distributed Workers. Compare actual duration
and cost with Blacksmith before changing the runner strategy. Preserve tasks'
shared-port and output-directory concurrency restrictions.
[Distributed execution](https://nx.dev/docs/features/ci-features/distribute-task-execution)

## 5. Consider finer e2e caching after the first improvements

The Playwright plugin currently configures only `targetName: "e2e"` and does not
configure Atomizer spec splitting. Nx 24 supports per-spec dependency directives
for split e2e tasks. Evaluate splitting and cache correctness together; the
current Astro tests exercise broad application behavior through dev servers.
[Nx 24 e2e caching](https://nx.dev/blog/nx-24-release#optimize-e2e-test-runs-on-ci)

Condition Chromium installation on selected browser tasks. Add PR-run
cancellation to stop obsolete runs. Those changes are independent of the Nx
release. Keep the existing production deployment cache-bypass policy separate.

## 6. Evaluate replacing Biome with Oxlint and Oxfmt

The migration is feasible, but should be a separate change from affected
selection and test caching. Biome is already a native tool. Nx's published
ESLint/Prettier comparisons do not establish a speedup for this repository.
Measure uncached checks, diagnostic coverage, and formatting changes before
replacing the current gate.

### Native Nx support

Use the official `@nx/oxlint` package aligned with Nx 24.0.2. It infers lint
targets and batches a multi-project run into one Oxlint process, while preserving
per-project cache entries. Its inputs cover lintable sources and configuration
dependencies, avoiding the current Biome plugin's broad `^default` fileset.
The plugin is experimental and requires Oxlint 1.70 or later.
[Nx Oxlint integration](https://nx.dev/docs/technologies/oxlint/introduction)

Put package-specific rules in JSON configuration files with explicit `extends`.
General CLI options come from the first project in a batch, so different
per-project `--config` arguments do not preserve independent configuration.
Keep warnings fatal with `denyWarnings` or a zero warning limit.
[Nx Oxlint executor](https://nx.dev/docs/technologies/oxlint/executors)

Nx supports Oxfmt through `nx format:check` and `nx format:write`. That formatter
integration is separate from inferred lint tasks; it does not provide cached
per-project formatting targets. Preserve a read-only CI `check` contract that
covers both lint and formatting. Ensure root scripts and `.github/actions` remain
covered because native lint inference requires `src` or `lib` for a root target.
[Nx formatter integration](https://nx.dev/docs/reference/code-formatting)

### Preserve architectural checks and rule coverage

Nine package Biome configurations each restrict 17 browser import specifiers.
`packages/realtime-protocol/src/layer-boundary.test.ts` checks those configurations
explicitly. Port the restrictions and their guard tests together. Use Oxlint's
native `eslint/no-restricted-imports` rule, including bare packages and subpaths.
Verify that removing a restriction makes a focused regression test fail.
[Restricted imports rule](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports)

Biome's recommended preset and Oxlint's default correctness rules are different.
Map the existing React Hooks, accessibility, TypeScript, and other enabled rules.
Review and translate the `biome-ignore` directives while retaining their reasons.
Do not replace the current preset with Oxlint defaults and assume equal coverage.
The official lint migrator does not currently automate Biome configuration.
[Oxlint configuration](https://oxc.rs/docs/guide/usage/linter/config.html),
[Biome migration request](https://github.com/oxc-project/oxlint-migrate/issues/454)

### Astro and formatting

Oxlint supports Astro JavaScript but does not lint Astro templates. Oxfmt
requires `@astrojs/compiler-rs` and the `astro` option to format Astro files.
Its Astro markup formatting uses bundled Prettier. Audit our current template
coverage before claiming equivalent lint coverage.
[Compatibility](https://oxc.rs/compatibility.html),
[Formatter language support](https://oxc.rs/docs/guide/usage/formatter/language-support)

`oxfmt --migrate biome` converts formatter settings, not lint rules. Convert
overrides and exclusions manually. Preserve single quotes, two-space indentation,
generated-file exclusions, and test exceptions. Limit the initial file scope to
what Biome currently checks; formatting Markdown, CSS, and other additional
formats would expand this migration.
[Oxfmt CLI](https://oxc.rs/docs/guide/usage/formatter/cli.html)

Enable and review import sorting explicitly because `sortImports` defaults to
off and differs from Biome's organizer. Consider `sortPackageJson: false` to
avoid unrelated manifest reordering. Put the initial formatter rewrite in its
own change so reviewers can distinguish it from tooling and behavior changes.
[Oxfmt sorting](https://oxc.rs/docs/guide/usage/formatter/sorting.html)

### Repository migration scope

Besides root tooling and the 32 project Biome configuration files, update:

- The layer-boundary rules and tests, plus existing suppression directives.
- Explicit evaluation-tool `check` commands and the docs SDK migration harness.
- The exported React starter's check command, config, frozen lockfile, and bundle
  file list.
- Editor defaults, agent guidance, contributor instructions, and CI comments.

Start with a representative server package and an Astro app in an isolated
trial. Compare their file coverage and diagnostics with Biome before deciding
whether to replace it workspace-wide. No Oxc packages were installed and no
migration benchmark was run for this assessment.

## Verification limits

All graph counts were generated with installed Nx 24.0.2 and no affected opt-in
flag. Local graph inspection set `NX_ISOLATE_PLUGINS=false`, `NX_DAEMON=false`,
and `NX_NO_CLOUD=true`. No tasks executed during graph selection.

Cloud workspace settings, plan details, cache permissions, and cache hit rates
were not inspected. No elapsed-time improvement has been measured. Published
Nx benchmark multipliers do not predict this repository's savings.

Root `typecheck`, `test`, and `check` passed with `--skip-nx-cache` on Nx 24.0.2.
All 26 selected verification tasks and prerequisites succeeded.
