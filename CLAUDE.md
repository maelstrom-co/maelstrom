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
nx test @maelstrom/react

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

## Architecture

```
@maelstrom/protocol  (foundation: shared types and message contract)
         │
    ┌────┴────┐
    ▼         ▼
@maelstrom/client   @maelstrom/engine
(framework-agnostic) (LLM decision core)
         │
         ▼
@maelstrom/react
(React bindings)
```

### Package Locations

| Package | Path | Purpose |
|---------|------|---------|
| `@maelstrom/protocol` | `packages/protocol/` | Core types and message definitions (transport-agnostic) |
| `@maelstrom/client` | `packages/client/` | Framework-agnostic client: Vessel Registry, Chart, Event System |
| `@maelstrom/react` | `packages/react/` | React components and hooks |
| `@maelstrom/engine` | `packages/engine/` | LLM decision engine using Vercel AI SDK |
| `@maelstrom/demo` | `apps/demo/` | Demo app (TanStack Start + React) |

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
- **Testing**: Vitest with Testing Library
- **Frontend**: React 19, TanStack Router/Start
- **Styling**: Tailwind CSS
- **LLM**: Vercel AI SDK (`ai` package) with pluggable providers

## Nx Workspace Notes

- Uses inferred targets via plugins (`@nx/js/typescript`, `@nx/vite/plugin`, `@nx/vitest`)
- No ESLint configured (linter: none)
- Tests depend on built packages (`"dependsOn": ["^build"]`)
