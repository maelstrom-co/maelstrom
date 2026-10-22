# Maelstrom Agent Guide

Maelstrom is an AI-orchestrated dynamic UI framework. An LLM arranges and controls UI components called Vessels from user intent and available chart space.

<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `bunx @tanstack/intent@0.5.6 list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx @tanstack/intent@0.5.6 load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
<!-- intent-skills:end -->

## Commands

Bun and Nx, per the existing lockfile and workspace conventions. The demo app runs with `nx dev demo`.

- `check` is the CI gate: Biome lint, format, and import order. There is no separate ESLint gate.
- Run typecheck, test, and `check` for every affected project before declaring work complete.
- Final verification must use `--skip-nx-cache`. Cached results are acceptable only during iteration.
- New packages need a `biome.json` containing `{"extends": "//"}`. Without one they lose per-project caching and are covered only by the root `check` target defined in `package.json`.

## Version Control

- Sign off every commit with `git commit -s`. CI rejects unsigned commits.
- Follow `CONTRIBUTING.md` for pull request and release workflow.

## Architecture Invariants

Rationale for these lives in `docs/architecture.md`.

- `@maelstrom-co/client` is framework-independent. React behavior belongs in `@maelstrom-co/react`. No test enforces this; both count as browser packages.
- Grid calculations use the Chart container, not the browser viewport.
- Process engine responses atomically: apply `set_layout`, then run `execute_actions`. The order is not type-enforced, and reversing it silently breaks actions targeting an instance introduced by the same response.
- Do not add an inline overflow or size-reconciliation step. The Chart `ResizeObserver` starts a new `chart_resize` request when whole grid dimensions change.
- Browser realtime packages never hold provider secrets. Server packages mint ephemeral tokens or provider grants.
- Realtime code sits in four layers: CONTRACT, BROWSER, SERVER, WORKER. No server or worker package may depend on a browser package. `packages/realtime-protocol/src/layer-boundary.test.ts` enforces the rule and documents the regression that prompted it.

Read `docs/realtime-voice-architecture.md` when the work touches realtime voice, including its provider package contracts, dependency boundaries, and runtime turn mode.

## Published APIs

The `@maelstrom-co/*` packages serve external consumers. The full contract is `apps/docs/src/content/docs/community/jsdoc-contract.mdx`.

- Add JSDoc to every public function, type, class, and exported field.
- Default internal code to no comments. Keep only non-obvious constraints and rationale.
- Never restate code behavior or reference tickets and current callers in comments.

## Workspace Conventions

- Never commit provider keys. `.env.example` documents the variables.
- SDK packages publish publicly to npm under the `@maelstrom-co` scope. Apps, infrastructure, and tools stay private. `CONTRIBUTING.md` covers publishing and preview releases.
- Keep Effect ecosystem versions aligned in the root catalog with Alchemy's peers. Do not pin `effect` or `@effect/platform-*` in app manifests, and do not add `@effect/language-service` until a `tsconfig` plugin loads it.

## Agent skills

- Issue tracker: `docs/agents/issue-tracker.md`
- Triage labels: `docs/agents/triage-labels.md`
- Domain docs: `docs/agents/domain.md`
