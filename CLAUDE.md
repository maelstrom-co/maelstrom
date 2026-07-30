# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `bunx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `bunx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

## What is Maelstrom?

Maelstrom is an AI-orchestrated dynamic UI framework. An LLM acts as an intelligent orchestrator that arranges, controls, and interacts with UI components (called "Vessels") based on user intent and available screen space.

## Development Commands

```bash
# Install dependencies
bun install

# Run the demo app (TanStack Start)
nx dev demo

# Build all packages
nx run-many -t build

# Run all tests
nx run-many -t test

# Run tests for a specific package
nx test @maelstrom-co/react

# Type check all packages
nx run-many -t typecheck

# Check all projects (Biome: lint + format + import order) — this is CI's gate
nx run-many -t check

# Auto-apply safe fixes (the only writing target)
nx run-many -t format
bunx biome check . --write

# Build dependencies before testing (required for tests)
# Tests depend on ^build - packages must be built first
```

Before declaring any change done, run typecheck, tests, AND `check` for the affected packages. `check` supersets `lint`: it adds the formatter and the import-order assist, and the Biome plugin bakes in `--error-on-warnings`, so a warning fails exactly the way it fails in CI. There is no separate local bar to remember any more.

Coverage is enforced two ways, and both matter: each project with a `biome.json` gets its own cached `check` target, and the root `@maelstrom-co/source:check` runs `biome check .` across the entire workspace. The root sweep is what catches files no project owns — `scripts/`, `.github/`, root config. A new package needs a `biome.json` (just `{"extends": "//"}`) to get its own target; without one it is still covered by the sweep, but loses per-project caching.

## Environment Setup

Copy `.env.example` to `.env` and configure API keys for LLM providers:
- `OPENAI_API_KEY` - OpenAI (demo engine + realtime voice)
- `GOOGLE_API_KEY` (or `GEMINI_API_KEY`) - Google Gemini (optional future adapter; not used by the demo)
- `ANTHROPIC_API_KEY` - Anthropic Claude

Packages are private and published under the `@maelstrom-co` scope on GitHub Packages. The root `.npmrc` maps the scope but stores no token. CI publishes releases and PR previews with its `GITHUB_TOKEN`; external installations require a classic PAT with `read:packages` from a user who can read the repository.

## Architecture

Four layers, with one directional rule: **nothing server-side or worker-side may
depend on anything browser-side.** The corollary that makes it work is
**contracts are subpaths, implementations are packages** — a minter and its
adapter share a wire contract without sharing a package. Arrows point from
dependent to dependency.

```
CONTRACT  protocol ◀───────────── realtime-protocol
          UI types, message         realtime wire topics
          contract                  and token grants
             ▲                             ▲
             │                             │
BROWSER   client ◀── realtime ◀── realtime-openai
             ▲                 ◀── realtime-livekit ──▶ realtime-vad
             │                                          neutral Silero VAD,
          react ◀── react-realtime                      no provider deps

SERVER    engine        realtime-openai-server    realtime-livekit-server
          LLM core      mints OpenAI tokens       mints LiveKit tokens

WORKER    realtime-livekit-agent
          Deepgram STT / Cartesia TTS over LiveKit Agents
```

Every SERVER and WORKER package depends on the CONTRACT layer only. That is
what keeps `OPENAI_API_KEY`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in
packages a browser bundle can never reach.
`packages/realtime-protocol/src/layer-boundary.test.ts` is the authority on
this rule and fails the build when it is broken. See `docs/adr/0001`–`0003`.

### Package Locations

| Package | Path | Purpose |
|---------|------|---------|
| `@maelstrom-co/protocol` | `packages/protocol/` | Core types, zod schemas, and message definitions (transport-agnostic) |
| `@maelstrom-co/realtime-protocol` | `packages/realtime-protocol/` | Contract leaf for realtime voice: token-grant types, mint-failure taxonomy, and wire topics. Depends only on `@maelstrom-co/protocol` and `zod`. Entry points `.`, `./openai`, `./livekit`. A new wire constant or grant field belongs **here**, never in an adapter package |
| `@maelstrom-co/client` | `packages/client/` | Framework-agnostic client: Chart Manager, Connection Manager, Command Processor, Vessel Manager, Orchestrator, voice-session seam |
| `@maelstrom-co/engine` | `packages/engine/` | LLM decision engine using @tanstack/ai |
| `@maelstrom-co/react` | `packages/react/` | React bindings: createMaelstrom, vessel, Provider, Chart, useMaelstrom, useVessel, useActions, useInstance, registerVessel, `.with()` extension builder |
| `@maelstrom-co/react-realtime` | `packages/react-realtime/` | React bindings for realtime voice: `maelstromRealtime()` extension and `useVoice()` |
| `@maelstrom-co/realtime` | `packages/realtime/` | Provider-neutral browser realtime-voice core: RealtimeSession, RealtimeProviderAdapter seam, ConnectRaceGuard, groundedDebounce, RealtimeVoiceError. No provider-specific code — every provider ships as a sibling package |
| `@maelstrom-co/realtime-vad` | `packages/realtime-vad/` | Provider-neutral browser voice-activity detector (Silero via `@ricky0123/vad-web`): `MediaStream` in, speech-boundary callbacks out. Knows about no provider. Its Node-only asset copier and `maelstrom-vad-assets` CLI sit behind the `./assets` subpath and must stay unreachable from the root entry |
| `@maelstrom-co/realtime-openai` | `packages/realtime-openai/` | OpenAI browser adapter implementing the `RealtimeProviderAdapter` seam from `@maelstrom-co/realtime`; consumes the token-grant contract from `@maelstrom-co/realtime-protocol/openai` |
| `@maelstrom-co/realtime-openai-server` | `packages/realtime-openai-server/` | Server-side mint of ephemeral OpenAI realtime tokens; holds `OPENAI_API_KEY`. Implements the same `@maelstrom-co/realtime-protocol/openai` contract, and depends on no browser package |
| `@maelstrom-co/realtime-livekit` | `packages/realtime-livekit/` | LiveKit browser adapter implementing the `RealtimeProviderAdapter` seam from `@maelstrom-co/realtime`; consumes the token-grant contract and wire topics from `@maelstrom-co/realtime-protocol/livekit` |
| `@maelstrom-co/realtime-livekit-server` | `packages/realtime-livekit-server/` | Server-side mint of LiveKit access tokens; holds `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`. Node-only, and depends on no browser package |
| `@maelstrom-co/realtime-livekit-agent` | `packages/realtime-livekit-agent/` | Node voice-agent worker: Deepgram STT / Cartesia TTS pipeline over LiveKit Agents, speaks engine responses back into the room |
| `@maelstrom-co/react-realtime` | `packages/react-realtime/` | React bindings for realtime voice: `maelstromRealtime()` extension, `useVoice`, `VoiceOrb`, `createLevelMeter` |
| `@maelstrom-co/demo` | `apps/demo/` | Demo app (TanStack Start + React) |

### Core Concepts

**Vessels**: State machines representing UI components. Each has:
- Unique ID and semantic description (for LLM understanding)
- Variants (discrete states, each declaring a `minSize` in grid cells)
- Actions (transitions between variants that the LLM can invoke)

`minSize` binds in grid mode only. `healGridLayout` drops any placement below
the variant minimum (`size_below_minimum`) and the retry prompt names the number
back to the model. Tiling never reads it — a leaf's size comes from the split
tree. The model is not told `minSize` up front either: the request serializer
omits it from the vessels section, so the only way the model learns a minimum is
by violating it and being re-prompted.

**Chart**: Layout surface in one of two modes, defaulting to `tiling`.
- **Tiling** (default): the model emits a binary tree as a preorder token array —
  `H` (split top/bottom), `V` (split left/right), an instance ID, or `null`. Each
  split halves its region; there are no coordinates. The client computes pixel
  rects from the container.
- **Grid**: the model emits integer cell coordinates and sizes, which the engine
  validates against the chart bounds and the variant's `minSize`.

Either way, sizing derives from the Chart container, not the browser viewport.
Only grid mode puts `Chart Dimensions: N×M cells` in the prompt; the tiling
prompt carries the tree and no dimensions.

**Engine**: Holds no layout state — the client owns that. Takes context (user
intent, current state, chart dimensions) and returns execution plan (actions to
invoke) + layout directives (where to position Vessels). Conversation history is
opt-in: pass `history: { store }` to `createEngine` and a `HistoryManager`
persists per-session turns and feeds them into the next prompt. The demo does
exactly this (`apps/demo/src/server/engine-config.ts`, in-memory store, 20-entry
window), so "stateless" describes only the no-history configuration.

### Execution Order (Critical)

When processing an engine response, the orchestrator dispatches an atomic batch
in this order — and the order is load-bearing, because layout is what declares
which instances exist. `applyTilingLayout` rebuilds the instance map from
`layout.instances`, so an action targeting a newly created instance has nothing
to run against until layout has created it:
1. Apply layout (`set_layout` — positions and sizes)
2. Execute actions (`execute_actions` — runs the `executionPlan`; may transition variants)

There is no inline "get new sizes" or "handle overflow" step. Applying the
response re-renders the UI; the React `<Chart>`'s `ResizeObserver` floors the new
pixel size to whole grid cells and, if they changed, schedules a fresh
`chart_resize` request — that observer is what closes the feedback loop. "Overflow"
is only CSS `overflow: hidden`; there is no resolver.

## Tech Stack

- **Monorepo**: Nx workspace with Bun package manager
- **Build**: Vite + SWC
- **Testing**: Bun test (packages), Vitest with Testing Library (apps)
- **Frontend**: React 19, TanStack Router/Start
- **Styling**: Tailwind CSS
- **LLM**: @tanstack/ai with @tanstack/ai-openai (`gpt-5.6-luna` in the demo), Effect for functional composition
- **Voice/Realtime**: OpenAI `gpt-realtime-2.1` over WebRTC (client-direct, ephemeral tokens), or LiveKit (self-hosted or cloud) with a Deepgram/Cartesia STT/TTS agent worker

## Coding Conventions

### Comments and JSDoc

The `@maelstrom-co/*` packages are published to external consumers, so the comment policy is tiered by API surface. To classify a symbol: check whether it's reachable from a **published entry point** — the package root (`src/index.ts`) or any subpath in the `exports` map with its own source entry, such as `@maelstrom-co/realtime-livekit/token` → `src/livekit-token.ts`. If yes, it's **public**. If no, it's **internal**. The root barrel is the common case, not the whole test; see [the JSDoc contract](apps/docs/src/content/docs/community/jsdoc-contract.mdx) for the full checklist.

**Public API** — symbols reachable from a published entry point (visible in consumer `.d.ts`, IDE hover, TypeDoc):
- JSDoc every public function, type, class, and exported field
- Cover WHAT + WHY + load-bearing invariants; add `@example` blocks on entry points where the call pattern isn't obvious from the signature
- Consumers can't ask on Slack — the docstring is the documentation

**Internal** — symbols reachable only within the package (helpers, sub-module barrels like `execution-plan/index.ts` that the root barrel doesn't re-export):
- Default to no comments
- Keep only non-obvious WHY: hidden constraints, subtle invariants, workarounds, severity/policy rationale
- Never restate WHAT the code does when names convey it
- Never reference tickets, callers, or consumers ("used by X", "added for Y", "MAE-123") — those rot and belong in commit messages / PR bodies

## Nx Workspace Notes

- Uses inferred targets via plugins (`@nx/js/typescript`, `@nx/vite/plugin`, `@nx/vitest`)
- Linting is Biome (no ESLint): `nx run-many -t check` — the plugin adds `--error-on-warnings` itself. Suppressions use `// biome-ignore <rule>: <why>` comments stating the invariant, and must sit on the line directly above the offending token, not above the enclosing declaration
- Tests depend on built packages (`"dependsOn": ["^build"]`)

## Issue Tracker Workflow

Issues live in **ClickUp** (migrated from Linear on 2026-07-21), driven via the ClickUp MCP.

When picking up a ClickUp task to start work on it, immediately move it to "In Progress" before doing anything else. Do this as the first action when a task is picked up — not after planning, not after the first commit. If it's already In Progress, leave it.

> Historical tasks carry Linear `MAE-XXX` ids in git history and PR titles; leave those as-is. The workspace structure, `MAE-###` id scheme, statuses, and triage-tag mapping are all confirmed and documented in `docs/agents/issue-tracker.md`.

## Agent skills

### Issue tracker

Issues and specs live in **ClickUp** (migrated from Linear 2026-07-21), driven via the ClickUp MCP (`mcp__*clickup*`; load schemas via `ToolSearch` query `clickup`) — not GitHub Issues. Dependencies use ClickUp's native task dependencies (blocking / waiting-on). External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`) are ClickUp **tags**; `wontfix` → the `canceled` status. Tags must be created in the ClickUp UI first — the MCP can't mint them. See `docs/agents/triage-labels.md`.

### Domain docs

**Single-context**: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
