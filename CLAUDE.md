# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Maelstrom?

Maelstrom is an AI-orchestrated dynamic UI framework. An LLM acts as an intelligent orchestrator that arranges, controls, and interacts with UI components (called "Vessels") based on user intent and available screen space.

## Development Commands

```bash
# Install dependencies
bun install

# Run the demo app (TanStack Start)
nx serve demo

# Build all packages
nx run-many -t build

# Run all tests
nx run-many -t test

# Run tests for a specific package
nx test @maelstrom-co/react

# Type check all packages
nx run-many -t typecheck

# Build dependencies before testing (required for tests)
# Tests depend on ^build - packages must be built first
```

## Environment Setup

Copy `.env.example` to `.env` and configure API keys for LLM providers:
- `GOOGLE_GENERATIVE_AI_API_KEY` - Google Gemini (used by demo)
- `OPENAI_API_KEY` - OpenAI
- `ANTHROPIC_API_KEY` - Anthropic Claude

Packages are published to GitHub Packages under the `@maelstrom-co` scope. The `.npmrc` at the repo root configures registry resolution and requires `GITHUB_TOKEN` to be set for installing or publishing scoped packages.

## Architecture

```
@maelstrom-co/protocol-old  (foundation: shared types, zod schemas, message contract)
         │
    ┌────┴────┐
    ▼         ▼
@maelstrom-co/client   @maelstrom-co/engine-old
(framework-agnostic) (LLM decision core: @tanstack/ai + Effect)
    │
    ├────────────┐
    ▼            ▼
@maelstrom-co/react  @maelstrom-co/voice
(React bindings)  (audio capture/playback, VAD)
```

### Package Locations

| Package | Path | Purpose |
|---------|------|---------|
| `@maelstrom-co/protocol-old` | `packages/protocol/` | Core types, zod schemas, and message definitions (transport-agnostic) |
| `@maelstrom-co/client` | `packages/client/` | Framework-agnostic client: Chart Manager, Connection Manager, Message Processor, Orchestrator |
| `@maelstrom-co/engine-old` | `packages/engine/` | LLM decision engine using @tanstack/ai + Effect, voice providers (Deepgram STT, Cartesia TTS) |
| `@maelstrom-co/react` | `packages/react/` | React bindings: createMaelstrom, vessel, Provider, Chart, useMaelstrom, useVessel, useActions, useInstance, useVoice, VoiceOrb |
| `@maelstrom-co/voice` | `packages/voice/` | Client-side audio: capture, playback, VAD (Silero via onnxruntime-web), voice sessions |
| `@maelstrom-co/demo` | `apps/demo/` | Demo app (TanStack Start + React) |

### Core Concepts

**Vessels**: State machines representing UI components. Each has:
- Unique ID and semantic description (for LLM understanding)
- Variants (discrete states with specific size requirements)
- Actions (transitions between variants that the LLM can invoke)

**Chart**: Grid-based layout system. The LLM works with integer grid coordinates (not pixels). Grid calculations are based on Chart container size, not browser viewport.

**Engine**: Stateless decision core. Takes context (user intent, current state, chart dimensions) and returns execution plan (actions to invoke) + layout directives (where to position Vessels).

### Execution Order (Critical)

When processing engine responses, the client MUST execute in this order:
1. Execute actions first (transitions variants)
2. Get new sizes (from variant minSize)
3. Apply layout (CSS transforms)
4. Handle overflow

## Tech Stack

- **Monorepo**: Nx workspace with Bun package manager
- **Build**: Vite + SWC
- **Testing**: Bun test (packages), Vitest with Testing Library (apps)
- **Frontend**: React 19, TanStack Router/Start
- **Styling**: Tailwind CSS
- **LLM**: @tanstack/ai with @tanstack/ai-gemini, Effect for functional composition
- **Voice**: Deepgram (STT), Cartesia (TTS), Silero VAD via onnxruntime-web

## Coding Conventions

### Comments and JSDoc

The `@maelstrom-co/*` packages are published to external consumers, so the comment policy is tiered by API surface. To classify a symbol: check whether it's re-exported from its package's `src/index.ts`. If yes, it's **public**. If no, it's **internal**.

**Public API** — symbols in the package's root barrel (visible in consumer `.d.ts`, IDE hover, TypeDoc):
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
- No ESLint configured (linter: none)
- Tests depend on built packages (`"dependsOn": ["^build"]`)
