# Docs Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the docs site from generic Starlight into a Fumadocs-inspired layout with Maelstrom's ocean brand identity — no top header, sidebar-integrated chrome, proper contrast, glass effects.

**Architecture:** Override 2 Starlight components (Header, Sidebar) and heavily update custom.css. The Header becomes mobile-only. The Sidebar gains logo, search, and utility icons. All contrast, glass, and layout fixes are CSS-only. No PageFrame override needed — CSS variables handle the header removal.

**Tech Stack:** Astro Starlight 0.38.2, Tailwind CSS v4, Starlight component overrides

**Spec:** `docs/superpowers/specs/2026-03-28-docs-visual-redesign.md`

---

### Task 1: Delete Splash Homepage & Configure Redirect

**Files:**
- Delete: `apps/docs/src/content/docs/index.mdx`
- Modify: `apps/docs/astro.config.ts`

- [ ] **Step 1: Delete the splash page**

```bash
rm apps/docs/src/content/docs/index.mdx
```

- [ ] **Step 2: Add redirect in astro.config.ts**

In `apps/docs/astro.config.ts`, add a `redirects` config to the `defineConfig` call, after the `output` line:

```typescript
redirects: {
  '/': '/getting-started/introduction/',
},
```

- [ ] **Step 3: Verify build**

```bash
npx nx build docs
```

Expected: Build succeeds, no 404 errors. Visiting `/` redirects to `/getting-started/introduction/`.

- [ ] **Step 4: Commit**

```bash
jj describe -m "fix(docs): remove splash homepage, redirect to introduction"
```

---

### Task 2: Override Header Component (Mobile-Only Thin Bar)

**Files:**
- Create: `apps/docs/src/components/Header.astro`
- Modify: `apps/docs/astro.config.ts`

- [ ] **Step 1: Create the custom Header component**

Create `apps/docs/src/components/Header.astro`:

```astro
---
import config from 'virtual:starlight/user-config';
import Search from 'virtual:starlight/components/Search';

const shouldRenderSearch =
  config.pagefind || config.components.Search !== '@astrojs/starlight/components/Search.astro';
---

<div class="header">
  <a href="/" class="site-logo">
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M16 6 C22 10, 24 14, 20 18 C16 22, 10 20, 12 14 C14 10, 18 12, 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
    <span>Maelstrom</span>
  </a>
  <div class="header-actions">
    {shouldRenderSearch && <Search />}
  </div>
</div>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 100%;
    gap: 0.5rem;
  }

  .site-logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--sl-color-white);
    text-decoration: none;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1rem;
    white-space: nowrap;
  }

  .site-logo svg {
    color: #00f0ff;
  }

  .site-logo:hover {
    opacity: 0.8;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Hide everything except search trigger on mobile header */
  @media (min-width: 50rem) {
    .header {
      display: none;
    }
  }
</style>
```

- [ ] **Step 2: Register the override in astro.config.ts**

In `apps/docs/astro.config.ts`, add the `components` property inside the `starlight({...})` config, after the `expressiveCode` block:

```typescript
components: {
  Header: './src/components/Header.astro',
},
```

- [ ] **Step 3: Hide the header container on desktop via CSS**

In `apps/docs/src/styles/custom.css`, add at the end of the file:

```css
/* ── Layout: hide header on desktop (Fumadocs pattern) ───────────── */

@media (min-width: 50rem) {
  :root {
    --sl-nav-height: 0rem;
  }

  .page > .header {
    display: none;
  }

  .sidebar-pane {
    inset-block-start: 0;
  }

  .main-frame {
    padding-top: var(--sl-mobile-toc-height);
  }
}
```

- [ ] **Step 4: Set mobile header height**

In `apps/docs/src/styles/custom.css`, update the mobile header vars:

```css
/* ── Layout: thin mobile header ──────────────────────────────────── */

@media (max-width: 49.9999rem) {
  :root {
    --sl-nav-height: 2.5rem;
  }
}
```

- [ ] **Step 5: Verify dev server**

```bash
npx nx dev docs
```

Open `http://localhost:4321/getting-started/introduction/`. Verify:
- Desktop: no top header bar, content starts at top
- Mobile (resize to < 800px): thin bar shows logo + search + hamburger

- [ ] **Step 6: Commit**

```bash
jj describe -m "feat(docs): override Header as mobile-only thin bar"
```

---

### Task 3: Override Sidebar Component (Logo, Search, Icons, Nav)

**Files:**
- Create: `apps/docs/src/components/Sidebar.astro`
- Modify: `apps/docs/astro.config.ts`

- [ ] **Step 1: Create the custom Sidebar component**

Create `apps/docs/src/components/Sidebar.astro`:

```astro
---
import config from 'virtual:starlight/user-config';
import Search from 'virtual:starlight/components/Search';
import SocialIcons from 'virtual:starlight/components/SocialIcons';
import ThemeSelect from 'virtual:starlight/components/ThemeSelect';
import MobileMenuFooter from 'virtual:starlight/components/MobileMenuFooter';
import SidebarPersister from '@astrojs/starlight/components/SidebarPersister.astro';
import SidebarSublist from '@astrojs/starlight/components/SidebarSublist.astro';

const { sidebar } = Astro.locals.starlightRoute;

const shouldRenderSearch =
  config.pagefind || config.components.Search !== '@astrojs/starlight/components/Search.astro';
---

<div class="sidebar-chrome">
  <a href="/" class="sidebar-logo">
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M16 6 C22 10, 24 14, 20 18 C16 22, 10 20, 12 14 C14 10, 18 12, 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
      />
    </svg>
    <span>Maelstrom</span>
  </a>

  {shouldRenderSearch && (
    <div class="sidebar-search">
      <Search />
    </div>
  )}

  <div class="sidebar-utils">
    <div class="sidebar-social">
      <SocialIcons />
    </div>
    <ThemeSelect />
  </div>

  <hr class="sidebar-divider" />
</div>

<SidebarPersister>
  <SidebarSublist sublist={sidebar} />
</SidebarPersister>

<div class="md:sl-hidden">
  <MobileMenuFooter />
</div>

<style>
  .sidebar-chrome {
    display: none;
    flex-direction: column;
    gap: 0.75rem;
    padding-bottom: 0.5rem;
  }

  /* Only show sidebar chrome on desktop — mobile uses the Header */
  @media (min-width: 50rem) {
    .sidebar-chrome {
      display: flex;
    }
  }

  .sidebar-logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--sl-color-white);
    text-decoration: none;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1rem;
    white-space: nowrap;
  }

  .sidebar-logo svg {
    color: #00f0ff;
  }

  .sidebar-logo:hover {
    opacity: 0.8;
  }

  .sidebar-search {
    width: 100%;
  }

  /* Make search button full-width in sidebar */
  .sidebar-search :global(button[data-open-modal]) {
    width: 100%;
    justify-content: flex-start;
  }

  .sidebar-utils {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .sidebar-social {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  /* Remove the default divider after social icons */
  .sidebar-social :global(a)::after {
    display: none;
  }

  .sidebar-divider {
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    margin: 0;
  }
</style>
```

- [ ] **Step 2: Register the Sidebar override in astro.config.ts**

Update the `components` object in `astro.config.ts`:

```typescript
components: {
  Header: './src/components/Header.astro',
  Sidebar: './src/components/Sidebar.astro',
},
```

- [ ] **Step 3: Verify dev server**

```bash
npx nx dev docs
```

Open `http://localhost:4321/getting-started/introduction/`. Verify:
- Desktop: Sidebar shows logo, search bar, GitHub + theme toggle, divider, then nav tree
- Mobile: Sidebar overlay has the same content when hamburger is tapped

- [ ] **Step 4: Commit**

```bash
jj describe -m "feat(docs): override Sidebar with logo, search, and utility icons"
```

---

### Task 4: Fix Sidebar Contrast & Active States

**Files:**
- Modify: `apps/docs/src/styles/custom.css`

- [ ] **Step 1: Replace existing sidebar styles**

In `apps/docs/src/styles/custom.css`, remove the existing sidebar-related CSS blocks:

Remove these blocks:
```css
/* Sidebar section labels */
:root {
  --sl-sidebar-section-label-font-size: 0.6875rem;
  --sl-sidebar-section-label-font-weight: 600;
}
```

```css
/* Subtle hover on sidebar items */
:root[data-theme='dark'] nav.sidebar a:hover {
  background-color: rgba(0, 240, 255, 0.04);
}

/* Active sidebar indicator */
:root[data-theme='dark'] nav.sidebar a[aria-current='page'] {
  border-left: 2px solid var(--sl-color-accent);
  background-color: rgba(0, 240, 255, 0.06);
}
```

And add these replacement blocks at the end of the file:

```css
/* ── Sidebar: contrast & active states ───────────────────────────── */

/* Sidebar background */
:root[data-theme='dark'] {
  --sl-color-bg-sidebar: #050a14;
}

:root[data-theme='light'] {
  --sl-color-bg-sidebar: #f5f0eb;
}

/* Section group headers — kicker style from www */
nav.sidebar .top-level > li > details > summary,
nav.sidebar .top-level > li > a.large {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

:root[data-theme='dark'] nav.sidebar .top-level > li > details > summary,
:root[data-theme='dark'] nav.sidebar .top-level > li > a.large {
  color: #e0f0ff;
}

/* Inactive sidebar links */
:root[data-theme='dark'] nav.sidebar a {
  color: #7a9ab5;
  transition: color 0.15s, background-color 0.15s;
}

:root[data-theme='dark'] nav.sidebar a:hover {
  color: #c4d4e4;
  background-color: rgba(0, 240, 255, 0.04);
}

/* Active sidebar link — high contrast with cyan indicator */
:root[data-theme='dark'] nav.sidebar a[aria-current='page'] {
  color: #e0f0ff;
  background-color: rgba(0, 240, 255, 0.08);
  border-inline-start: 2px solid #00f0ff;
  font-weight: 500;
}

/* Light mode sidebar */
:root[data-theme='light'] nav.sidebar a {
  color: #4a6a85;
}

:root[data-theme='light'] nav.sidebar a:hover {
  color: #0a1e35;
  background-color: rgba(0, 102, 255, 0.04);
}

:root[data-theme='light'] nav.sidebar a[aria-current='page'] {
  color: #0a1e35;
  background-color: rgba(0, 102, 255, 0.08);
  border-inline-start: 2px solid #0066ff;
  font-weight: 500;
}

/* Sidebar border */
:root[data-theme='dark'] .sidebar-pane {
  border-inline-end-color: rgba(255, 255, 255, 0.06);
}
```

- [ ] **Step 2: Verify contrast**

Open `http://localhost:4321/getting-started/introduction/` and visually check:
- Active link ("Introduction") has bright text, cyan left border, subtle background
- Section headers ("Getting Started") are uppercase, mono font, bright
- Inactive links are visible but muted
- Toggle to light mode and verify light mode sidebar is readable

- [ ] **Step 3: Commit**

```bash
jj describe -m "fix(docs): improve sidebar contrast and active link visibility"
```

---

### Task 5: Glass Effects & Brand Elements

**Files:**
- Modify: `apps/docs/src/styles/custom.css`

- [ ] **Step 1: Update code block styling to glass treatment**

In `apps/docs/src/styles/custom.css`, replace the existing code block CSS:

Remove:
```css
/* Code blocks: ocean-tinted background */
:root[data-theme='dark'] .expressive-code pre {
  --ec-codeBg: #0a1525;
  border-color: rgba(0, 240, 255, 0.08);
}
```

Add:
```css
/* ── Glass effects from www ──────────────────────────────────────── */

/* Code blocks: glass treatment */
:root[data-theme='dark'] .expressive-code .frame {
  background: rgba(15, 43, 74, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0.5rem;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 4px 24px rgba(0, 0, 0, 0.25);
}

:root[data-theme='dark'] .expressive-code pre {
  --ec-codeBg: transparent;
}

/* Asides/Callouts: glass-card treatment */
:root[data-theme='dark'] .starlight-aside {
  background: rgba(10, 30, 53, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 0.75rem;
  border-inline-start-width: 3px;
}

/* Content area background */
:root[data-theme='dark'] {
  --sl-color-bg: #0a0e1a;
}

:root[data-theme='light'] {
  --sl-color-bg: #fefcf8;
}

/* Link color: cyan */
:root[data-theme='dark'] {
  --sl-color-text-accent: #00f0ff;
}

:root[data-theme='light'] {
  --sl-color-text-accent: #0066ff;
}
```

- [ ] **Step 2: Verify glass effects**

Open a page with code blocks and asides (e.g., `/getting-started/quick-start/`). Verify:
- Code blocks have the frosted glass look (semi-transparent navy with subtle border)
- Asides have the glass-card treatment
- Content background is slightly lighter than sidebar
- Links are cyan (dark) or blue (light)

- [ ] **Step 3: Commit**

```bash
jj describe -m "feat(docs): add glass effects and brand colors from www"
```

---

### Task 6: Mobile Layout Polish

**Files:**
- Modify: `apps/docs/src/styles/custom.css`

- [ ] **Step 1: Add mobile-specific styles**

Add at the end of `apps/docs/src/styles/custom.css`:

```css
/* ── Mobile layout polish ────────────────────────────────────────── */

/* Mobile header styling */
@media (max-width: 49.9999rem) {
  .page > .header {
    background-color: #050a14;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
}

/* Mobile sidebar overlay backdrop */
:root[data-theme='dark'] {
  --sl-color-backdrop-overlay: rgba(5, 8, 16, 0.8);
}

/* Mobile sidebar background */
:root[data-theme='dark'] .sidebar-pane {
  background-color: #050a14;
}

/* Mobile ToC bar: styled like Fumadocs breadcrumb */
:root[data-theme='dark'] starlight-toc mobile-starlight-toc {
  background-color: #050a14;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

/* Navigation bar background (for mobile) */
:root[data-theme='dark'] {
  --sl-color-bg-nav: #050a14;
}

:root[data-theme='light'] {
  --sl-color-bg-nav: #f5f0eb;
}
```

- [ ] **Step 2: Verify mobile layout**

Resize browser to < 800px width. Verify:
- Thin header with logo + search + hamburger
- Tapping hamburger opens sidebar overlay with dark backdrop
- ToC breadcrumb bar is styled consistently
- Search modal opens properly

- [ ] **Step 3: Commit**

```bash
jj describe -m "feat(docs): polish mobile layout with ocean theme"
```

---

### Task 7: Light Mode Theme

**Files:**
- Modify: `apps/docs/src/styles/custom.css`

- [ ] **Step 1: Add light mode overrides**

Add at the end of `apps/docs/src/styles/custom.css`:

```css
/* ── Light mode ──────────────────────────────────────────────────── */

:root[data-theme='light'] {
  --sl-color-hairline-shade: rgba(10, 30, 53, 0.08);
}

:root[data-theme='light'] .expressive-code .frame {
  background: rgba(245, 240, 235, 0.8);
  border: 1px solid rgba(10, 30, 53, 0.1);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

:root[data-theme='light'] .starlight-aside {
  background: rgba(245, 240, 235, 0.6);
  border: 1px solid rgba(10, 30, 53, 0.08);
  border-radius: 0.75rem;
  border-inline-start-width: 3px;
}

:root[data-theme='light'] nav.sidebar .top-level > li > details > summary,
:root[data-theme='light'] nav.sidebar .top-level > li > a.large {
  color: #0a1e35;
}

:root[data-theme='light'] .sidebar-pane {
  background-color: #f5f0eb;
  border-inline-end-color: rgba(10, 30, 53, 0.08);
}

/* Light mode mobile header */
@media (max-width: 49.9999rem) {
  :root[data-theme='light'] .page > .header {
    background-color: #f5f0eb;
    border-bottom: 1px solid rgba(10, 30, 53, 0.08);
  }
}
```

- [ ] **Step 2: Verify light mode**

Toggle to light mode. Verify:
- Background is warm off-white (`#fefcf8`)
- Sidebar is slightly darker warm tone
- Code blocks and asides have light glass treatment
- All text is readable
- Active sidebar link uses blue instead of cyan

- [ ] **Step 3: Commit**

```bash
jj describe -m "feat(docs): add light mode theme with warm ocean palette"
```

---

### Task 8: Final Build Verification & Screenshot

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

```bash
npx nx build docs
```

Expected: Build succeeds with 42+ pages, no errors.

- [ ] **Step 2: Visual verification with Chrome DevTools**

Use Chrome DevTools MCP to take screenshots of:
1. Desktop dark mode — introduction page
2. Desktop light mode — introduction page
3. Mobile dark mode (390x844) — introduction page
4. Mobile dark mode — sidebar open
5. Mobile dark mode — search open

Verify all spec requirements:
- No top header on desktop
- Sidebar has logo, search, GitHub, theme toggle, divider, nav
- Active link has cyan left border and bright text
- Section headers are mono/uppercase
- Code blocks have glass treatment
- Light mode is readable

- [ ] **Step 3: Commit all changes**

```bash
jj describe -m "feat(docs): visual redesign — Fumadocs layout with ocean brand

Removes default Starlight header (desktop), integrates logo/search/icons
into sidebar, fixes contrast/active states, adds glass effects from www,
supports light/dark modes.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
