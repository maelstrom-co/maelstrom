# Library Documentation Site — Design Spec

## Context

Maelstrom has 12+ open Linear issues for documentation (package READMEs, JSDoc, CONTRIBUTING.md, library vision) scattered across the "Open Source Readiness" project. Rather than tackling each independently, this spec consolidates the documentation effort into a single deliverable: a dedicated docs site at `docs.maelstrom-ai.co`.

The site uses **Astro Starlight** for documentation infrastructure (sidebar, search, MDX, routing) with a custom **ocean-tinted Fumadocs aesthetic** (deep navy background, cyan accents, Geist fonts) that creates visual continuity with the marketing landing page at `maelstrom-ai.co`.

## Approach

**Starlight + Custom Theme Layer.** Use Starlight out of the box for structure and override CSS variables + a few components to match the Fumadocs visual style. No separate theme package (YAGNI — one docs site). No custom docs framework (Starlight provides search, sidebar, ToC, responsive layout, dark/light mode for free).

**Search:** Pagefind (Starlight's built-in default). Zero config, client-side static search, ~6KB bundle. Sufficient for docs-scale content.

## Content Architecture (Diátaxis)

The sidebar is organized into 6 top-level groups following the Diátaxis framework:

### 1. Getting Started
The onramp — not a full tutorial, just enough to get running.
- **Introduction** — What is Maelstrom, why it exists, who it's for
- **Quick Start** — Minimal working example (install → create vessels → render)
- **Core Concepts** — Vessels, variants, actions, charts, engine
- **Installation** — Package installation, peer dependencies, environment setup

### 2. Tutorials (Learning-oriented)
Step-by-step journeys where the user follows along and has a working result at the end.
- **Build Your First Dashboard** — Register vessels, connect to engine, render a chart
- **Add Voice Control** — Integrate voice session, VAD, speech-to-text
- **Deploy to Production** — Engine setup, connectors, production configuration

### 3. Guides (Task-oriented)
Goal-oriented recipes grouped by package. User has a specific problem, gets a focused solution.

**React:**
- Creating Vessels
- Vessel Variants & Actions
- Lazy Loading Vessels
- Layout Modes (Grid vs Tiling)
- Error Handling

**Engine:**
- Custom LLM Providers
- System Prompt Customization
- Conversation History

**Client:**
- Custom Connectors
- Programmatic Layout Control

**Voice:**
- Voice Integration
- VAD Configuration

### 4. API Reference (Information-oriented)
Complete, accurate documentation of every public export, organized by package.

**@maelstrom-co/react:**
- `createMaelstrom()`, `vessel()`, `Provider`, `Chart`, `useMaelstrom()`

**@maelstrom-co/client:**
- `Orchestrator`, Connectors (`WebSocketConnector`, `HttpConnector`, `VoiceWebSocketConnector`), `ChartManager`, `CommandProcessor`, `VesselManager`

**@maelstrom-co/protocol:**
- Vessel types (`Vessel`, `VesselVariant`, `VesselAction`), Chart types (`ChartDimensions`, `GridLayout`, `TilingLayout`), Message protocol (`ChartRequest`, `MaelstromResponse`)

**@maelstrom-co/engine:**
- `createEngine()`, `LLMProvider` interface, `HistoryManager`, prompt building

### 5. Understanding (Explanation-oriented)
Why and how it works — architecture, design decisions, vision.
- **Why Maelstrom?** — Placeholder page for MAE-58 vision/manifesto content (written separately)
- **Architecture Overview** — Migrated from existing `docs/architecture.md`
- **How the LLM Orchestrates UI** — The engine's decision-making process
- **The Vessel State Machine** — Variant/action lifecycle
- **Grid vs Tiling Layout** — When to use each, how the algorithms work

### 6. Community
- **Contributing** — Links to the repo's standalone `CONTRIBUTING.md` file
- **Changelog** — Release history

## Visual Design

**Ocean-Tinted Fumadocs:** Fumadocs layout and typography with the Maelstrom ocean color palette.

- **Background:** Deep navy (#050a14) — not pure black, matches the landing page's deep tones
- **Accent color:** Cyan (#00f0ff) — same as the landing page
- **Fonts:** Geist Sans (body) + Geist Mono (code) via Astro font providers
- **Sidebar:** Fumadocs-style with uppercase section labels, subtle left-border active indicators
- **Code blocks:** Ocean-themed syntax highlighting (cyan/seafoam on dark navy)
- **Overall feel:** Clean, professional, visually continuous with `maelstrom-ai.co` without being distracting

Implementation is primarily CSS variable overrides on Starlight's theme tokens, plus minimal component overrides for sidebar and navigation polish.

## Technical Setup

### Project location
`apps/docs/` — standalone Astro Starlight app in the monorepo.

### File structure
```
apps/docs/
├── astro.config.ts          # Starlight + React + Tailwind v4
├── package.json             # @maelstrom-co/docs
├── tsconfig.json
├── wrangler.json            # Cloudflare Pages (docs.maelstrom-ai.co)
├── src/
│   ├── content/
│   │   └── docs/            # All MDX content
│   │       ├── getting-started/
│   │       ├── tutorials/
│   │       ├── guides/
│   │       │   ├── react/
│   │       │   ├── engine/
│   │       │   ├── client/
│   │       │   └── voice/
│   │       ├── reference/
│   │       │   ├── react/
│   │       │   ├── client/
│   │       │   ├── protocol/
│   │       │   └── engine/
│   │       ├── understanding/
│   │       └── community/
│   ├── styles/
│   │   └── custom.css       # Ocean-tinted Fumadocs overrides
│   ├── components/          # Custom Starlight component overrides
│   └── assets/
└── public/
    └── favicon.svg
```

### Build & tooling
- **Nx integration:** Reuses existing `@maelstrom-co/astro-plugin` (`tools/astro-plugin/`) for inferred targets: `nx serve docs`, `nx build docs`, `nx preview docs`, `nx typecheck docs`
- **Tailwind CSS v4:** Via `@tailwindcss/vite` (same setup as `apps/www/`)
- **Astro 6 + Starlight:** Latest versions from the catalog
- **Search:** Pagefind (built-in, zero config)

### Deployment
- **Platform:** Cloudflare Pages (static output)
- **Domain:** `docs.maelstrom-ai.co` (subdomain, separate from landing page)
- **CI:** `nx build docs` in GitHub Actions workflow

### Content reuse from existing files
- `docs/architecture.md` → `understanding/architecture.mdx`
- `README.md` core concepts → `getting-started/core-concepts.mdx`
- `apps/www/src/styles/global.css` ocean color values → `custom.css`
- `CLAUDE.md` package descriptions → reference page intros

## Linear Issue Management

### New issue to create
**"Build Library Documentation Site"** — High priority, labels: Library, Documentation.

### Issues superseded (close as "superseded")
- MAE-13 — JSDoc for @maelstrom/react
- MAE-14 — JSDoc for @maelstrom/client
- MAE-15 — JSDoc for @maelstrom/engine
- MAE-16 — JSDoc for @maelstrom/protocol
- MAE-17 — README for @maelstrom/protocol
- MAE-18 — README for @maelstrom/client
- MAE-19 — README for @maelstrom/engine
- MAE-20 — README for @maelstrom/react
- MAE-83 — Document @maelstrom-co/react README after migration

### Issues that stay open
- **MAE-58** — Write Maelstrom library vision (docs site has a placeholder for this content)
- **MAE-22** — Create CONTRIBUTING.md (standalone file in repo root; docs site links to it)
- **MAE-11** — Document factory function naming convention (goes into CONTRIBUTING.md)

## Verification

1. `nx serve docs` starts the dev server and renders the landing page
2. Sidebar navigation matches the content architecture above
3. Ocean theme is applied (deep navy bg, cyan accents, Geist fonts)
4. Pagefind search indexes content and returns results
5. `nx build docs` produces static output with no errors
6. MDX pages render correctly with code blocks, Starlight components (Tabs, Cards, Aside, Steps)
7. Cross-links between sections work (getting started → reference, guides → reference)
8. Responsive layout works on mobile
