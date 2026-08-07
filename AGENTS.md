# Maelstrom Agent Guide

Maelstrom is an AI-orchestrated dynamic UI framework. An LLM arranges and controls UI components called Vessels from user intent and available chart space.

<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `bunx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific skill; load more only when the task spans multiple concerns.
<!-- intent-skills:end -->

## Commands

Use Bun and Nx according to the existing lockfile and workspace conventions.

```bash
bun install
nx dev demo
nx run-many -t build
nx run-many -t test
nx run-many -t typecheck
nx run-many -t check
nx run-many -t format
```

- Tests depend on `^build`; build dependencies before testing.
- `check` is the CI lint, format, and import-order gate. There is no separate ESLint gate.
- Run typecheck, tests, and `check` for every affected project before declaring work complete.
- Final verification must use `--skip-nx-cache` for affected typecheck, test, and check targets. Cached results are acceptable only during iteration.
- The root `@maelstrom-co/source:check` covers files outside project roots. New packages need a `biome.json` containing `{"extends": "//"}` for per-project caching.

## Version Control

Detect the checkout's VCS before running mutating commands.

- Follow the DCO sign-off requirements in `CONTRIBUTING.md` for every revision or commit.
- When `jj root` succeeds, use `jj` for every mutating operation. Never mutate a Jujutsu repository with Git.
- In a Jujutsu repository without a colocated `.git`, pass `--repo maelstrom-co/maelstrom` to `gh` because it cannot infer the repository.
- Review Jujutsu remote changes with `jj diff -r 'main..<bookmark>@origin' --git`. Files in the working copy may still represent `main`.
- Push Jujutsu changes by setting and tracking the bookmark, then running `jj git push --bookmark <name>`.
- In Jujutsu revsets, a bare string can resolve as a change ID instead of a bookmark. Use the complete bookmark name.
- When `jj root` fails, use Git and follow the workflow in `CONTRIBUTING.md`.

## Architecture Invariants

- `@maelstrom-co/protocol` is the transport-independent contract foundation.
- `@maelstrom-co/client` is framework-independent. React behavior belongs in `@maelstrom-co/react`.
- The engine is a stateless decision core.
- Grid calculations use the Chart container, not the browser viewport.
- Process engine responses atomically in this order: apply `set_layout`, then run `execute_actions`.
- Do not add an inline overflow or size-reconciliation step. The Chart `ResizeObserver` starts a new `chart_resize` request when whole grid dimensions change.
- Browser realtime packages never hold provider secrets. Server packages mint ephemeral tokens or provider grants.

Before changing architecture or domain terminology, read `docs/architecture.md` and `CONTEXT.md`. Read `docs/realtime-voice-architecture.md` when the work touches realtime voice.

## Published APIs

The `@maelstrom-co/*` packages serve external consumers. A symbol is public when reachable from the package root or another published `exports` entry.

- Add JSDoc to every public function, type, class, and exported field.
- Explain what, why, and load-bearing invariants. Add examples when the call pattern is not obvious.
- Default internal code to no comments. Keep only non-obvious constraints and rationale.
- Never restate code behavior or reference tickets and current callers in comments.

Before changing a published API, read `apps/docs/src/content/docs/community/jsdoc-contract.mdx` for the complete contract.

## Workspace Conventions

- Nx targets are inferred through workspace plugins.
- Biome suppressions use `// biome-ignore <rule>: <why>` directly above the offending token.
- Environment variables are documented in `.env.example`. Never commit provider keys.
- Public packages use npm. Per-PR previews use GitHub Packages and CI's `GITHUB_TOKEN`.

## Agent skills

### Issue tracker

Private maintainer work lives in ClickUp. Public community and contributor work lives in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Public GitHub issues use the five canonical triage labels. Private ClickUp work uses the maintainer mappings. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses one root `CONTEXT.md` and system-wide ADRs under `docs/adr/`. See `docs/agents/domain.md`.
