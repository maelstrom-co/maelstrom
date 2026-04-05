# PR #87 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all issues identified in the comprehensive review of PR #87 (Maelstrom docs site), one jj commit per fix.

**Architecture:** Each task is a self-contained fix targeting specific files. Tasks are independent and ordered by severity (critical first). All changes are on branch `naxo/mae-89-build-library-documentation-site`.

**Tech Stack:** Astro Starlight, CSS, TypeScript, jj (Jujutsu VCS)

**VCS:** Use `jj` for all version control operations. Each task ends with `jj commit -m "..."` to create a new commit.

---

### Task 1: Remove committed .playwright-mcp/ debug logs and add to .gitignore

**Files:**
- Modify: `.gitignore` (add `.playwright-mcp/` entry)
- Delete: `.playwright-mcp/console-2026-03-30T00-11-54-220Z.log`
- Delete: `.playwright-mcp/console-2026-03-30T00-21-25-777Z.log`

- [ ] **Step 1: Add `.playwright-mcp/` to .gitignore**

Add after the `.wrangler/` line (line 58 area, under the `# Astro` section):

```gitignore
.playwright-mcp/
```

- [ ] **Step 2: Remove the tracked files**

```bash
jj file untrack .playwright-mcp/console-2026-03-30T00-11-54-220Z.log .playwright-mcp/console-2026-03-30T00-21-25-777Z.log
```

If `jj file untrack` doesn't work for this case, manually delete the files:

```bash
rm -rf .playwright-mcp/
```

- [ ] **Step 3: Commit**

```bash
jj commit -m "chore: remove .playwright-mcp/ debug logs and add to .gitignore"
```

---

### Task 2: Add clipboard copy failure feedback in Head.astro and Pagination.astro

**Files:**
- Modify: `apps/docs/src/components/Head.astro:48-50`
- Modify: `apps/docs/src/components/Pagination.astro:139-141`

- [ ] **Step 1: Fix Head.astro clipboard catch block**

In `apps/docs/src/components/Head.astro`, replace the empty catch block (lines 48-50):

```javascript
        } catch {
          // Clipboard API unavailable (HTTP, denied permission, background tab)
        }
```

With:

```javascript
        } catch {
          copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
          copyBtn.setAttribute('aria-label', 'Copy failed — try selecting text manually');
          setTimeout(() => {
            copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
            copyBtn.setAttribute('aria-label', 'Copy to clipboard');
          }, 2000);
        }
```

- [ ] **Step 2: Fix Pagination.astro clipboard catch block**

In `apps/docs/src/components/Pagination.astro`, replace the empty catch block (lines 139-141):

```javascript
      } catch {
        // Clipboard API unavailable
      }
```

With:

```javascript
      } catch {
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Copy failed`;
        setTimeout(() => { btn.innerHTML = original; }, 2000);
      }
```

- [ ] **Step 3: Commit**

```bash
jj commit -m "fix(docs): show visual feedback when clipboard copy fails"
```

---

### Task 3: Guard localStorage access in Sidebar.astro and Pagination.astro

**Files:**
- Modify: `apps/docs/src/components/Sidebar.astro:330-340` (add helper functions)
- Modify: `apps/docs/src/components/Sidebar.astro:372,376,387,390,452` (use helpers)
- Modify: `apps/docs/src/components/Pagination.astro:70,84` (use try-catch)

- [ ] **Step 1: Add safe storage helpers in Sidebar.astro**

In `apps/docs/src/components/Sidebar.astro`, add these helpers right after the `LABEL_TO_FRAMEWORK` declaration (after line 339):

```typescript
  function safeGetItem(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  function safeSetItem(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
  }
```

- [ ] **Step 2: Replace all bare localStorage calls in Sidebar.astro**

Replace all `localStorage.getItem(` with `safeGetItem(` and all `localStorage.setItem(` with `safeSetItem(` throughout the Sidebar.astro `<script>` block. Specifically:

Line 372: `localStorage.getItem('maelstrom-framework')` → `safeGetItem('maelstrom-framework')`
Line 376: `localStorage.setItem('starlight-synced-tabs__framework', savedLabel)` → `safeSetItem('starlight-synced-tabs__framework', savedLabel)`
Line 387: `localStorage.setItem('maelstrom-framework', fw)` → `safeSetItem('maelstrom-framework', fw)`
Line 390: `localStorage.setItem('starlight-synced-tabs__framework', label)` → `safeSetItem('starlight-synced-tabs__framework', label)`
Line 452: `localStorage.setItem('maelstrom-framework', fw)` → `safeSetItem('maelstrom-framework', fw)`

- [ ] **Step 3: Guard localStorage in Pagination.astro PageFeedback class**

In `apps/docs/src/components/Pagination.astro`, wrap the localStorage calls in the `PageFeedback` class with try-catch. Replace lines 70-75:

```javascript
      const stored = localStorage.getItem(`feedback:${pageId}`);

      if (stored) {
        const btn = this.querySelector(`[data-value="${stored}"]`);
        if (btn) btn.setAttribute('data-selected', 'true');
      }
```

With:

```javascript
      let stored: string | null = null;
      try { stored = localStorage.getItem(`feedback:${pageId}`); } catch { /* storage unavailable */ }

      if (stored) {
        const btn = this.querySelector(`[data-value="${stored}"]`);
        if (btn) btn.setAttribute('data-selected', 'true');
      }
```

And replace line 84:

```javascript
          localStorage.setItem(`feedback:${pageId}`, value || '');
```

With:

```javascript
          try { localStorage.setItem(`feedback:${pageId}`, value || ''); } catch { /* storage unavailable */ }
```

- [ ] **Step 4: Commit**

```bash
jj commit -m "fix(docs): guard localStorage access for restricted storage contexts"
```

---

### Task 4: Move PostHog API key to environment variable

**Files:**
- Modify: `apps/docs/src/components/PostHog.astro:2-9`

- [ ] **Step 1: Replace hardcoded key with env var**

Replace the entire content of `apps/docs/src/components/PostHog.astro` with:

```astro
---
const posthogKey = import.meta.env.PUBLIC_POSTHOG_KEY;
const posthogHost = import.meta.env.PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
---

{posthogKey && (
<script
  is:inline
  data-key={posthogKey}
  data-host={posthogHost}
>
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group identify setPersonProperties setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags resetGroups onFeatureFlags addFeatureFlagsHandler onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    var s = document.currentScript;
    posthog.init(s.dataset.key, { api_host: s.dataset.host })
</script>
)}
```

Note: Since this is a static build (`output: 'static'`), the key still gets inlined at build time. But this pattern allows environment separation (dev/staging/prod) and key rotation without code changes.

- [ ] **Step 2: Add env vars to `.env.example`**

Check if `.env.example` exists and add:

```
PUBLIC_POSTHOG_KEY=phc_Hoboj1FND6HaqHyoWaMAJdwQ26B9VubNT55zAwR7ySy
PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Also add these to the local `.env` file so the site still works.

- [ ] **Step 3: Commit**

```bash
jj commit -m "refactor(docs): move PostHog API key to environment variable"
```

---

### Task 5: Remove unused @astrojs/cloudflare dependency

**Files:**
- Modify: `apps/docs/package.json:17` (remove `@astrojs/cloudflare` line)

- [ ] **Step 1: Remove the dependency from package.json**

In `apps/docs/package.json`, remove this line from `devDependencies`:

```json
    "@astrojs/cloudflare": "^13.1.4",
```

- [ ] **Step 2: Update lock file**

```bash
bun install
```

- [ ] **Step 3: Commit**

```bash
jj commit -m "chore(docs): remove unused @astrojs/cloudflare adapter"
```

---

### Task 6: Clean up wrangler.json dead traces config

**Files:**
- Modify: `apps/docs/wrangler.json`

- [ ] **Step 1: Remove the dead traces block**

Replace the current `wrangler.json` content with:

```json
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "docs",
  "compatibility_date": "2026-03-30",
  "assets": {
    "directory": "./dist"
  },
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
    "logs": {
      "enabled": true,
      "head_sampling_rate": 1,
      "persist": true,
      "invocation_logs": true
    }
  }
}
```

This removes the contradictory `traces` block (which had `enabled: false` but `persist: true` and `head_sampling_rate: 1`).

- [ ] **Step 2: Commit**

```bash
jj commit -m "chore(docs): remove dead traces config from wrangler.json"
```

---

### Task 7: Fix inaccurate comments

**Files:**
- Modify: `apps/docs/src/components/Head.astro:21`
- Modify: `apps/docs/src/components/Pagination.astro:86`
- Modify: `apps/docs/src/components/Pagination.astro:113`
- Modify: `apps/docs/src/components/PostHog.astro:2` (if still present after Task 4)
- Modify: `apps/docs/src/styles/custom.css:89`
- Modify: `apps/docs/src/styles/custom.css:437`

- [ ] **Step 1: Fix Head.astro comment**

Line 21 — change:

```javascript
      // Check for title from data attribute or preceding comment
```

To:

```javascript
      // Check for title from data attribute
```

- [ ] **Step 2: Fix Pagination.astro PostHog comment**

Line 86 — change:

```javascript
          // Send to PostHog (same event name as Fumadocs convention)
```

To:

```javascript
          // Send feedback event to PostHog
```

- [ ] **Step 3: Fix Pagination.astro extraction comment**

Line 113 — change:

```javascript
      // Extract text content, preserving code blocks
```

To:

```javascript
      // Convert page DOM to markdown, preserving structure (headings, lists, code blocks, quotes)
```

- [ ] **Step 4: Fix CSS heading comment**

In `apps/docs/src/styles/custom.css`, line 89 — change:

```css
/* Heading hierarchy with gradient separator */
```

To:

```css
/* h2 gradient bottom border */
```

- [ ] **Step 5: Fix CSS scrollbar comment**

In `apps/docs/src/styles/custom.css`, line 437 — change:

```css
    /* Radix/shadcn-style thin scrollbar: subtle, visible on hover */
```

To:

```css
    /* Thin native scrollbar: subtle by default, more visible on hover */
```

- [ ] **Step 6: Remove redundant file-path comment from PostHog.astro**

If PostHog.astro still has `// src/components/PostHog.astro` after Task 4, remove it. (Task 4's rewrite already removes this.)

- [ ] **Step 7: Commit**

```bash
jj commit -m "docs: fix inaccurate comments in components and CSS"
```

---

### Task 8: Consolidate fragmented CSS theme blocks

**Files:**
- Modify: `apps/docs/src/styles/custom.css`

- [ ] **Step 1: Consolidate dark theme custom properties**

Find all scattered `:root[data-theme='dark'] { --sl-* }` blocks that contain only custom property declarations (lines 309, 322, 327, 350, 504, 520) and merge them into a single block. Place the consolidated block at line 309 (where the first one currently is), replacing all the individual ones:

```css
:root[data-theme='dark'] {
  --sl-color-bg: #050810;
  --sl-color-text-accent: #00f0ff;
  --sl-color-bg-sidebar: #050810;
  --sl-color-backdrop-overlay: rgba(5, 8, 16, 0.8);
  --sl-color-bg-nav: #050a14;
  --pagefind-ui-primary: #00f0ff;
  --pagefind-ui-text: #e0f0ff;
  --pagefind-ui-background: #0a1e35;
  --pagefind-ui-border: rgba(255, 255, 255, 0.1);
  --pagefind-ui-tag: rgba(0, 240, 255, 0.1);
}
```

Remove the now-redundant individual blocks at their original locations (lines 322-324, 327-333, 350-352, 504-506, 520-522).

- [ ] **Step 2: Consolidate light theme custom properties**

Similarly, merge all scattered `:root[data-theme='light'] { --sl-* }` blocks (lines 317, 335, 343, 354, 524, 530) into a single block:

```css
:root[data-theme='light'] {
  --sl-color-bg: #fefcf8;
  --sl-color-text-accent: #0066ff;
  --sl-color-bg-sidebar: #f5f0eb;
  --sl-color-bg-nav: #f5f0eb;
  --sl-color-hairline-shade: rgba(10, 30, 53, 0.08);
  --sl-color-white: #0a1e35;
  --sl-color-black: #fefcf8;
  --sl-color-text: #1a3a55;
  --sl-color-gray-1: #2a4a65;
  --sl-color-gray-2: #3a5a75;
  --sl-color-gray-3: #5a7a95;
  --sl-color-gray-4: #9ab4cc;
  --sl-color-gray-5: #d4dce4;
  --sl-color-gray-6: #eae4dc;
  --pagefind-ui-primary: #0066ff;
  --pagefind-ui-text: #0a1e35;
  --pagefind-ui-background: #fefcf8;
  --pagefind-ui-border: rgba(10, 30, 53, 0.1);
  --pagefind-ui-tag: rgba(0, 102, 255, 0.08);
}
```

Remove the now-redundant individual blocks.

- [ ] **Step 3: Merge adjacent media queries**

Merge the two `@media (max-width: 49.9999rem)` blocks at lines 487-491 and 496-501 into one:

```css
@media (max-width: 49.9999rem) {
  :root {
    --sl-nav-height: 2.5rem;
  }

  .page > .header {
    background-color: var(--sl-color-bg-nav);
    border-bottom: 1px solid var(--sl-color-hairline-shade, rgba(255, 255, 255, 0.06));
  }
}
```

Remove the second block and the `/* ── Mobile layout polish ────... */` / `/* Mobile header styling */` comments that separated them.

- [ ] **Step 4: Extract shared inline code pill base properties**

Replace the two themed inline code pill blocks (lines 102-118) with:

```css
.sl-markdown-content :not(pre) > code {
  padding: 0.1em 0.4em;
  border-radius: 0.3rem;
  font-size: 0.875em;
}

:root[data-theme='dark'] .sl-markdown-content :not(pre) > code {
  background: rgba(0, 240, 255, 0.08);
  border: 1px solid rgba(0, 240, 255, 0.12);
  color: #7dd3fc;
}

:root[data-theme='light'] .sl-markdown-content :not(pre) > code {
  background: rgba(0, 102, 255, 0.06);
  border: 1px solid rgba(0, 102, 255, 0.1);
  color: #1d4ed8;
}
```

- [ ] **Step 5: Extract scrollbar colors into custom properties**

Add to the consolidated `:root[data-theme='dark']` block:

```css
  --scrollbar-idle: rgba(255, 255, 255, 0.08);
  --scrollbar-hover: rgba(255, 255, 255, 0.15);
```

Add to the consolidated `:root[data-theme='light']` block:

```css
  --scrollbar-idle: rgba(10, 30, 53, 0.08);
  --scrollbar-hover: rgba(10, 30, 53, 0.15);
```

Then replace all 4 scrollbar-color declarations in `html` and `.sidebar-content sl-sidebar-state-persist` to use:

```css
scrollbar-color: var(--scrollbar-idle) transparent;
```

And on hover:

```css
scrollbar-color: var(--scrollbar-hover) transparent;
```

Remove the `html[data-theme='light']` scrollbar blocks and the `:root[data-theme='light'] .sidebar-content sl-sidebar-state-persist` scrollbar blocks since the custom properties handle the theming.

- [ ] **Step 6: Verify the CSS is still syntactically valid**

```bash
# Quick build check — Astro will fail on broken CSS
cd apps/docs && npx astro check 2>&1 | head -30
```

- [ ] **Step 7: Commit**

```bash
jj commit -m "refactor(docs): consolidate CSS theme blocks and reduce duplication"
```

---

### Task 9: Simplify Nx plugin async wrapper

**Files:**
- Modify: `tools/astro-plugin/src/index.ts:25-36`

- [ ] **Step 1: Simplify createNodesV2**

Replace lines 25-36:

```typescript
export const createNodesV2: CreateNodesV2<AstroPluginOptions> = [
  '**/astro.config.{ts,mjs}',
  async (configFiles, options, context) => {
    return await createNodesFromFiles(
      (configFile, options, context) =>
        createNodesInternal(configFile, options, context),
      configFiles,
      options,
      context,
    );
  },
];
```

With:

```typescript
export const createNodesV2: CreateNodesV2<AstroPluginOptions> = [
  '**/astro.config.{ts,mjs}',
  (configFiles, options, context) =>
    createNodesFromFiles(createNodesInternal, configFiles, options, context),
];
```

This removes the unnecessary `async/await` wrapper and the redundant arrow function that just forwards arguments.

- [ ] **Step 2: Commit**

```bash
jj commit -m "refactor(astro-plugin): simplify createNodesV2 callback"
```
