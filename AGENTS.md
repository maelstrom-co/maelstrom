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

- `bun run check` runs native Nx lint and formatting checks without writes. CI runs affected `lint` targets and `nx format:check --all`. Read `docs/tooling.md` when changing rules or file coverage.
- Run typecheck, test, and lint for every affected project, plus the native formatting check, before declaring work complete.
- When a test reads files outside its project, include those paths in its Nx inputs.
- Final verification must use `--skip-nx-cache`. Cached results are acceptable only during iteration.
- The official Oxlint plugin infers project lint targets. When adding root source files or tool projects, update the root lint target paths and exclusions. Server and worker packages need a `.oxlintrc.json` extending the root and restricting browser imports; the layer-boundary suite enforces this.

## Version Control

- Sign off every commit with `git commit -s`. CI rejects unsigned commits.
- Follow `CONTRIBUTING.md` for pull request and release workflow.

## Architecture Invariants

Rationale for these lives in `docs/architecture.md`.

- `@maelstrom-co/client` is framework-independent. React behavior belongs in `@maelstrom-co/react`. No test enforces this; both count as browser packages.
- Grid calculations use the Chart container, not the browser viewport.
- Process engine responses atomically: apply `set_layout`, then run `execute_actions`. The order is not type-enforced, and reversing it silently breaks actions targeting an instance introduced by the same response.
- Do not add an inline overflow or size-reconciliation step. The Chart `ResizeObserver` starts a new `chart_resize` request when whole grid dimensions change.
- Voice providers submit natural-language intent. The Engine plans against snapshots from client-owned stores; provider grounding is not planning input.
- Turn mode is runtime state. When browser VAD fails and the adapter reports manual mode, `RealtimeSession` must expose manual controls.
- Application-owned long-lived provider credentials must remain server-side. Browser grants and the documented in-memory visitor-owned-key flow are deliberate exceptions; preserve their ownership, lifetime, and storage boundaries.
- Realtime code sits in four layers: CONTRACT, BROWSER, SERVER, WORKER. No server or worker package may depend on a browser package. `packages/realtime-protocol/src/layer-boundary.test.ts` enforces the rule and documents the regression that prompted it.

Read `docs/realtime-voice-architecture.md` when the work touches realtime voice, including its provider package contracts, dependency boundaries, and runtime turn mode.

## Code Review Rules

The Architecture Invariants above are review requirements, not only
implementation guidance.

### Establish the affected contract

For client, Engine, protocol, or React integration changes, read the
relevant sections of `docs/architecture.md` and the nearest contract tests.
For realtime changes, also read `docs/realtime-voice-architecture.md`.

Trace materially changed behavior through its callers, state owner, and
observable consumers, including unchanged code. Check both sides of a
changed boundary. Do not treat the diff or PR description as the full
specification.

### Request completion and Action execution

When reviewing request admission, response application, or voice tools:

- Success must describe the requesting operation's own settled application
  batch. Transport completion and global queue idleness are not substitutes.
- Unknown outcomes do not prove that no side effect occurred. Do not convert
  them into "not submitted" or automatically replay the mutation.
- Preserve layout-before-Actions within the response batch. "Atomic" does
  not imply rollback after partial application.
- Preserve Action order within each Instance. Concurrent execution across
  different Instances is intentional, not itself a defect.
- On disconnect or provider replacement, distinguish pending work from
  active work. Preserve active outcomes without delivering to stale adapters.

### Evidence required for findings

Identify the triggering input or event ordering, the violated contract,
and the observable consequence. Check existing guards, ownership,
cleanup, and callers before concluding that a failure path is reachable.

For public SDK compatibility, a minimal previously valid external usage
is sufficient evidence; an in-repository consumer is not required.

A missing test alone is not a correctness finding. Name the behavior that
would fail. Existing tests are relevant only when they exercise that path.

Report introduced or worsened defects and concrete architectural contract
violations. Do not substitute generic advice, implementation preferences,
or repeated CI diagnostics for findings.

Distinguish static analysis from executed verification. Never imply that
tests were run or a failure reproduced when they were not.

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
