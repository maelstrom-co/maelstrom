# Docs Visual Redesign — Design Spec

## Context

The docs site (`apps/docs/`) was scaffolded with Astro Starlight's default layout and an initial ocean color theme. The result looks like generic Starlight, not like Fumadocs. Specific issues:

- Splash homepage duplicates the www landing page
- Sidebar active link contrast is terrible — barely visible
- Layout has a chunky top bar that wastes vertical space
- No visual continuity with the www app's design system

This spec defines the visual overhaul to make the docs feel like Fumadocs with Maelstrom's ocean brand DNA.

## Design Decisions

- **Subtle brand touches** — Ocean colors, fonts, glass on callouts/code blocks. No noise overlay, no glows, no animations. Clean and doc-focused.
- **No top header bar** — Logo, search, and icons integrated into the sidebar (Fumadocs pattern).
- **Dark default, light toggle available** — Theme toggle kept for accessibility.

## Changes

### 1. Remove Splash Homepage

Delete `src/content/docs/index.mdx`. Configure Starlight to redirect `/` → `/getting-started/introduction/`. Users always land directly in the docs since the marketing landing page lives at `maelstrom-ai.co`.

### 2. Remove Top Header Bar (Desktop)

Override Starlight's `Header` component:

**Desktop (≥ 72em):** Render nothing. The header is completely removed. Logo, search, GitHub link, and theme toggle all move into the sidebar.

**Mobile (< 72em):** Render a thin ~40px strip with:
- Logo (left)
- Search icon + sidebar hamburger icon (right)

This matches Fumadocs' mobile pattern where the top bar is minimal and the sidebar opens as an overlay.

### 3. Sidebar Redesign

Override Starlight's `Sidebar` component to include, from top to bottom:

1. **Logo** — "Maelstrom" with spiral icon, matching www app's nav logo treatment
2. **Search bar** — Compact search input showing `⌘K` hint, triggers Pagefind modal
3. **Utility icons row** — GitHub link + theme toggle, small icon buttons
4. **Divider** — Thin line separating chrome from navigation
5. **Navigation tree** — The existing sidebar nav, restyled

**Sidebar styling:**
- Background: `#050a14` (abyss) — darker than content area for visual separation
- Width: `18.75rem` (300px, Starlight default — matches Fumadocs)
- Border-right: `1px solid rgba(255, 255, 255, 0.06)`

### 4. Sidebar Contrast & Active States

**Section group headers** ("Getting Started", "Tutorials", etc.):
- Color: `#e0f0ff` (bright text from www `--color-text`)
- Font: mono (`IBM Plex Mono`), 0.7rem, uppercase, `letter-spacing: 0.1em`
- Matches www's `.section-kicker` pattern

**Active link:**
- Text: `#e0f0ff` (bright)
- Background: `rgba(0, 240, 255, 0.08)`
- Left border: `2px solid #00f0ff` (cyan)
- Matches Fumadocs' active indicator pattern

**Inactive links:**
- Text: `#7a9ab5` (www's `--color-text-muted`)
- Hover text: `#c4d4e4`
- Hover background: `rgba(0, 240, 255, 0.04)`

### 5. Mobile Layout

Following Fumadocs' mobile patterns:

**Mobile header (< 72em):**
- Thin strip (~40px): logo left, search + hamburger right
- Background: `#050a14`
- Border-bottom: `1px solid rgba(255, 255, 255, 0.06)`

**Mobile ToC bar:**
- Keep Starlight's `MobileTableOfContents` but restyle to match Fumadocs' breadcrumb/ToC dropdown
- Sticky below mobile header
- Shows current page title, expands to show heading list on tap
- Active heading highlighted with cyan left border

**Mobile sidebar:**
- Keep Starlight's slide-in overlay behavior
- Same styling as desktop sidebar (logo, search, utility icons, nav tree)
- Overlay background: `rgba(5, 8, 16, 0.8)` backdrop

**Mobile search:**
- Keep Starlight's Pagefind modal — already opens as full-screen dialog
- Restyle to match ocean theme

### 6. Content Area

- `--sl-content-width: 52rem` (wider than Starlight's default 45rem)
- Background: `#0a0e1a` (deep) — slightly lighter than sidebar for contrast
- ToC stays on right (Starlight default, matches Fumadocs)
- Link color: `#00f0ff` (cyan)

### 7. Brand Elements from www

**Code blocks (glass treatment):**
- Background: `rgba(15, 43, 74, 0.4)`
- Border: `1px solid rgba(255, 255, 255, 0.08)`
- Border-radius: `0.5rem`
- Subtle box-shadow: `inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 4px 24px rgba(0, 0, 0, 0.25)`

**Asides/Callouts (glass-card treatment):**
- Background: `rgba(10, 30, 53, 0.6)`
- Border: `1px solid rgba(255, 255, 255, 0.06)`
- Border-radius: `0.75rem`

**Typography:**
- Body: General Sans (via `--font-body`)
- Headings: Clash Display (via `--font-heading`)
- Code: IBM Plex Mono (via `--font-code`)
- Sidebar kickers: IBM Plex Mono, uppercase, cyan-tinted

## Component Overrides Required

| Starlight Component | Override Strategy |
|---|---|
| `Header` | Custom: thin mobile-only bar, hidden on desktop |
| `Sidebar` | Custom: add logo, search, utility icons above nav tree |
| `PageFrame` | May need override to adjust grid when header is removed on desktop |

All other components (ToC, content, footer, pagination) are styled via CSS only — no component overrides needed.

## Files to Create/Modify

| File | Action |
|---|---|
| `src/content/docs/index.mdx` | Delete |
| `astro.config.ts` | Add `components` overrides, remove index from sidebar, configure redirect |
| `src/styles/custom.css` | Major update: all contrast fixes, glass effects, layout variables |
| `src/components/Header.astro` | Create: thin mobile-only bar |
| `src/components/Sidebar.astro` | Create: logo + search + icons + nav tree |
| `src/components/PageFrame.astro` | Create if needed: adjust grid for no-header desktop |

## Light Mode

Dark is the default. Light mode should use:
- Background: `#fefcf8` (daylight from www)
- Sidebar background: `#f5f0eb` (warm off-white)
- Text: `#0a1e35` (ocean)
- Accent: `#0066ff` (blue, more readable than cyan on light backgrounds)
- Active sidebar: blue left border instead of cyan

## Verification

1. Desktop: No top header bar. Sidebar shows logo, search, icons, then nav. Content fills remaining space with ToC on right.
2. Mobile: Thin header with logo + search + hamburger. Sidebar slides in as overlay. ToC breadcrumb bar below header.
3. Sidebar active link is clearly visible with cyan left border and brighter text.
4. Section group headers are distinct from nav links (mono, uppercase, brighter).
5. Code blocks and asides have glass treatment from www.
6. Light/dark toggle works. Both themes are readable.
7. `nx build docs` succeeds with no errors.
