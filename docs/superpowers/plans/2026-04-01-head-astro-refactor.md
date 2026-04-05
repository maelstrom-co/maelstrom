# Head.astro Module Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Head.astro's 200-line inline script into two focused modules (`code-blocks.ts`, `toc-path.ts`) with comprehensive tests, then rewire the component.

**Architecture:** Split into pure functions (bezier path math, scroll offset calculation) and DOM orchestrators. Pure functions are tested without a DOM; DOM modules are tested with happy-dom. Head.astro becomes a 7-line import-and-call script.

**Tech Stack:** Bun test runner (`bun:test`), happy-dom for DOM environment, existing Nx workspace conventions.

---

## File Structure

```
apps/docs/
  bunfig.toml                           — CREATE (test preload config)
  package.json                          — MODIFY (add happy-dom devDep, nx test target)
  src/
    lib/
      code-blocks.ts                    — CREATE (~65 LOC)
      toc-path.ts                       — CREATE (~120 LOC)
      __tests__/
        setup.ts                        — CREATE (happy-dom bootstrap)
        code-blocks.test.ts             — CREATE
        toc-path.test.ts                — CREATE
    components/
      Head.astro                        — MODIFY (replace 200-line script with 7 lines)
```

---

### Task 1: Set up test infrastructure for docs app

**Files:**
- Create: `apps/docs/bunfig.toml`
- Create: `apps/docs/src/lib/__tests__/setup.ts`
- Modify: `apps/docs/package.json`

- [ ] **Step 1: Add happy-dom devDependency and nx test target**

Edit `apps/docs/package.json` to add `happy-dom` and the `nx.targets.test` block:

```json
{
  "name": "@maelstrom-co/docs",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "dependencies": {
    "@astrojs/react": "catalog:",
    "@astrojs/sitemap": "catalog:",
    "@astrojs/starlight": "^0.38.2",
    "@astrojs/starlight-tailwind": "^5.0.0",
    "astro": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:"
  },
  "devDependencies": {
    "@astrojs/check": "catalog:",
    "@cloudflare/workers-types": "^4.20260317.1",
    "@tailwindcss/vite": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "happy-dom": "catalog:",
    "starlight-llms-txt": "^0.8.0",
    "tailwindcss": "catalog:",
    "typescript": "catalog:"
  },
  "nx": {
    "targets": {
      "test": {
        "command": "bun test",
        "options": {
          "cwd": "{projectRoot}"
        }
      }
    }
  }
}
```

- [ ] **Step 2: Create bunfig.toml**

Create `apps/docs/bunfig.toml`:

```toml
[test]
preload = ["./src/lib/__tests__/setup.ts"]
```

- [ ] **Step 3: Create happy-dom test setup**

Create `apps/docs/src/lib/__tests__/setup.ts`:

```typescript
import { afterEach, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;

let happyWindow = new Window();

beforeEach(() => {
  happyWindow = new Window();
  // @ts-expect-error - happy-dom types don't perfectly match DOM types
  globalThis.document = happyWindow.document;
  // @ts-expect-error - happy-dom types don't perfectly match DOM types
  globalThis.window = happyWindow;
});

afterEach(() => {
  happyWindow.close();
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
});
```

- [ ] **Step 4: Install dependencies**

Run: `cd apps/docs && bun install`

- [ ] **Step 5: Verify test runner works**

Run: `cd apps/docs && bun test`
Expected: `0 pass` (no test files yet, should exit cleanly)

- [ ] **Step 6: Commit**

```bash
git add apps/docs/bunfig.toml apps/docs/src/lib/__tests__/setup.ts apps/docs/package.json
git commit -m "chore(docs): add bun test infrastructure with happy-dom"
```

---

### Task 2: TDD pure functions — `resolveActiveIndex` and `buildSerpentinePath`

**Files:**
- Create: `apps/docs/src/lib/toc-path.ts`
- Create: `apps/docs/src/lib/__tests__/toc-path.test.ts`

These are the pure math functions extracted from `initTocPath()` in Head.astro. Zero DOM dependency — tested with plain `bun:test`.

- [ ] **Step 1: Write failing tests for `resolveActiveIndex`**

Create `apps/docs/src/lib/__tests__/toc-path.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { resolveActiveIndex, buildSerpentinePath } from '../toc-path';

describe('resolveActiveIndex', () => {
  // Constants matching the defaults in the implementation
  const BASE_OFFSET = 100;
  const NEAR_BOTTOM_RATIO = 0.6;

  it('returns 0 for empty headings array', () => {
    expect(resolveActiveIndex([], 0, 2000, 800)).toBe(0);
  });

  it('returns 0 when no heading has scrolled past the offset', () => {
    // All headings are below the 100px offset line
    expect(resolveActiveIndex([200, 400, 600], 0, 2000, 800)).toBe(0);
  });

  it('returns the last heading that scrolled past the offset', () => {
    // headingTops represent getBoundingClientRect().top values
    // A heading at top=50 is above the 100px offset → active
    // A heading at top=150 is below the 100px offset → not active
    expect(resolveActiveIndex([50, 80, 150, 300], 0, 2000, 800)).toBe(1);
  });

  it('returns last index when all headings are past offset', () => {
    expect(resolveActiveIndex([10, 20, 30], 0, 2000, 800)).toBe(2);
  });

  it('uses base offset when far from page bottom', () => {
    // scrollY=0, scrollHeight=5000, vh=800 → distToBottom=4200
    // nearBottomZone = 800 * 0.6 = 480
    // distToBottom (4200) >> nearBottomZone (480) → offset = baseOffset = 100
    // heading at top=99 is at the offset line → active
    // heading at top=101 is just below → not active
    expect(resolveActiveIndex([99, 101], 0, 5000, 800)).toBe(0);
  });

  it('expands offset near bottom of page', () => {
    // scrollY=4200, scrollHeight=5000, vh=800
    // maxScroll = 5000 - 800 = 4200
    // distToBottom = max(0, 4200 - 4200) = 0
    // offset = 100 + (1 - 0) * (400 - 100) = 100 + 300 = 400
    // So headings with top <= 400 should be active
    expect(resolveActiveIndex([350, 450], 4200, 5000, 800)).toBe(0);
    // heading at 350 is active (≤400), heading at 450 is not
  });

  it('at exact bottom, offset equals half viewport height', () => {
    // distToBottom = 0 → offset = baseOffset + (vh/2 - baseOffset) = vh/2
    // vh=800 → offset = 400
    const vh = 800;
    const scrollHeight = 2000;
    const scrollY = scrollHeight - vh; // at bottom
    expect(resolveActiveIndex([399, 401], scrollY, scrollHeight, vh)).toBe(0);
  });

  it('handles single heading', () => {
    expect(resolveActiveIndex([50], 0, 2000, 800)).toBe(0);
    expect(resolveActiveIndex([200], 0, 2000, 800)).toBe(0);
  });
});

describe('buildSerpentinePath', () => {
  it('returns empty string for empty points', () => {
    expect(buildSerpentinePath([])).toBe('');
  });

  it('returns a move-to for a single point', () => {
    expect(buildSerpentinePath([{ x: 10, y: 20 }])).toBe('M 10,20');
  });

  it('builds a cubic bezier for two points', () => {
    const result = buildSerpentinePath([
      { x: 10, y: 20 },
      { x: 30, y: 60 },
    ]);
    // midY = (20 + 60) / 2 = 40
    // C prev.x,midY curr.x,midY curr.x,curr.y
    expect(result).toBe('M 10,20 C 10,40 30,40 30,60');
  });

  it('builds multiple bezier segments', () => {
    const result = buildSerpentinePath([
      { x: 2, y: 10 },
      { x: 8, y: 30 },
      { x: 4, y: 50 },
    ]);
    // Segment 1: midY = (10+30)/2 = 20, C 2,20 8,20 8,30
    // Segment 2: midY = (30+50)/2 = 40, C 8,40 4,40 4,50
    expect(result).toBe('M 2,10 C 2,20 8,20 8,30 C 8,40 4,40 4,50');
  });

  it('handles points with same x (vertical line)', () => {
    const result = buildSerpentinePath([
      { x: 5, y: 0 },
      { x: 5, y: 100 },
    ]);
    // midY = 50, C 5,50 5,50 5,100
    expect(result).toBe('M 5,0 C 5,50 5,50 5,100');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/docs && bun test src/lib/__tests__/toc-path.test.ts`
Expected: FAIL — `Cannot find module '../toc-path'`

- [ ] **Step 3: Implement the pure functions**

Create `apps/docs/src/lib/toc-path.ts`:

```typescript
// ── Pure functions (exported for testing) ─────────────────────────

export interface Point {
  x: number;
  y: number;
}

/** Build an SVG path string with cubic bezier curves connecting points. */
export function buildSerpentinePath(points: Point[]): string {
  if (points.length === 0) return '';
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midY = (prev.y + curr.y) / 2;
    d += ` C ${prev.x},${midY} ${curr.x},${midY} ${curr.x},${curr.y}`;
  }
  return d;
}

/**
 * Given heading positions (as getBoundingClientRect().top values) and scroll
 * metrics, return the index of the active heading.
 *
 * Near the bottom of the page, the activation offset smoothly expands from
 * baseOffset to viewportHeight/2 so headings that can't physically reach the
 * base offset still get their turn.
 */
export function resolveActiveIndex(
  headingTops: number[],
  scrollY: number,
  scrollHeight: number,
  viewportHeight: number,
  baseOffset = 100,
  nearBottomRatio = 0.6,
): number {
  if (headingTops.length === 0) return 0;

  const maxScroll = scrollHeight - viewportHeight;
  const distToBottom = Math.max(0, maxScroll - scrollY);
  const nearBottomZone = viewportHeight * nearBottomRatio;

  const offset =
    distToBottom < nearBottomZone
      ? baseOffset +
        (1 - distToBottom / nearBottomZone) * (viewportHeight / 2 - baseOffset)
      : baseOffset;

  let active = 0;
  for (let i = 0; i < headingTops.length; i++) {
    if (headingTops[i] <= offset) active = i;
  }
  return active;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/docs && bun test src/lib/__tests__/toc-path.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/docs/src/lib/toc-path.ts apps/docs/src/lib/__tests__/toc-path.test.ts
git commit -m "feat(docs): extract and test pure ToC math functions"
```

---

### Task 3: TDD `enhanceCodeBlocks` module

**Files:**
- Create: `apps/docs/src/lib/code-blocks.ts`
- Create: `apps/docs/src/lib/__tests__/code-blocks.test.ts`

This extracts the code block enhancement logic from Head.astro lines 13-62. Tested with happy-dom.

- [ ] **Step 1: Write failing tests**

Create `apps/docs/src/lib/__tests__/code-blocks.test.ts`:

```typescript
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { enhanceCodeBlocks } from '../code-blocks';

describe('enhanceCodeBlocks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function createCodeBlock(options?: { title?: string; code?: string }) {
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.textContent = options?.code ?? 'console.log("hello")';
    pre.appendChild(codeEl);
    pre.classList.add('astro-code');
    if (options?.title) {
      pre.setAttribute('data-title', options.title);
    }
    document.body.appendChild(pre);
    return pre;
  }

  it('wraps .astro-code blocks in a .code-block container', () => {
    createCodeBlock();
    enhanceCodeBlocks();

    const wrapper = document.querySelector('.code-block');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('.astro-code')).not.toBeNull();
  });

  it('adds a copy button with correct aria-label', () => {
    createCodeBlock();
    enhanceCodeBlocks();

    const btn = document.querySelector('.code-copy-btn');
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('Copy to clipboard');
    expect(btn!.getAttribute('type')).toBe('button');
  });

  it('adds a title bar when data-title is present', () => {
    createCodeBlock({ title: 'app.tsx' });
    enhanceCodeBlocks();

    const header = document.querySelector('.code-block-header');
    expect(header).not.toBeNull();
    const title = document.querySelector('.code-block-title');
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe('app.tsx');
  });

  it('does not add a title bar when data-title is absent', () => {
    createCodeBlock();
    enhanceCodeBlocks();

    const header = document.querySelector('.code-block-header');
    expect(header).toBeNull();
  });

  it('is idempotent — does not double-wrap on second call', () => {
    createCodeBlock();
    enhanceCodeBlocks();
    enhanceCodeBlocks();

    const wrappers = document.querySelectorAll('.code-block');
    expect(wrappers.length).toBe(1);
  });

  it('enhances multiple code blocks independently', () => {
    createCodeBlock({ title: 'first.ts' });
    createCodeBlock({ title: 'second.ts' });
    enhanceCodeBlocks();

    const wrappers = document.querySelectorAll('.code-block');
    expect(wrappers.length).toBe(2);
    const titles = document.querySelectorAll('.code-block-title');
    expect(titles[0].textContent).toBe('first.ts');
    expect(titles[1].textContent).toBe('second.ts');
  });

  it('accepts a custom root element', () => {
    const container = document.createElement('div');
    const pre = document.createElement('pre');
    pre.classList.add('astro-code');
    container.appendChild(pre);
    document.body.appendChild(container);

    // Also add one outside the container — should NOT be enhanced
    createCodeBlock();

    enhanceCodeBlocks(container);

    // Only the one inside the container should be wrapped
    const wrappers = container.querySelectorAll('.code-block');
    expect(wrappers.length).toBe(1);

    // The one outside should remain unwrapped
    const outsideBlock = document.body.querySelector(':scope > .astro-code');
    expect(outsideBlock).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/docs && bun test src/lib/__tests__/code-blocks.test.ts`
Expected: FAIL — `Cannot find module '../code-blocks'`

- [ ] **Step 3: Implement enhanceCodeBlocks**

Create `apps/docs/src/lib/code-blocks.ts`:

```typescript
const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const CHECK_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ERROR_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

/** Enhance all `.astro-code` blocks with copy buttons and optional title bars. Idempotent. */
export function enhanceCodeBlocks(root: ParentNode = document): void {
  root.querySelectorAll('.astro-code').forEach((block) => {
    if (block.parentElement?.classList.contains('code-block')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';

    const title = block.getAttribute('data-title') || '';
    if (title) {
      const header = document.createElement('div');
      header.className = 'code-block-header';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'code-block-title';
      titleSpan.textContent = title;
      header.appendChild(titleSpan);
      wrapper.appendChild(header);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.type = 'button';
    copyBtn.setAttribute('aria-label', 'Copy to clipboard');
    copyBtn.innerHTML = COPY_ICON;
    copyBtn.addEventListener('click', async () => {
      const code =
        block.querySelector('code')?.textContent || block.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.innerHTML = CHECK_ICON;
        setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON;
        }, 2000);
      } catch {
        copyBtn.innerHTML = ERROR_ICON;
        copyBtn.setAttribute(
          'aria-label',
          'Copy failed — try selecting text manually',
        );
        setTimeout(() => {
          copyBtn.innerHTML = COPY_ICON;
          copyBtn.setAttribute('aria-label', 'Copy to clipboard');
        }, 2000);
      }
    });

    block.parentNode!.insertBefore(wrapper, block);
    wrapper.appendChild(block);
    wrapper.appendChild(copyBtn);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/docs && bun test src/lib/__tests__/code-blocks.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/docs/src/lib/code-blocks.ts apps/docs/src/lib/__tests__/code-blocks.test.ts
git commit -m "feat(docs): extract and test code block enhancement module"
```

---

### Task 4: TDD `initTocPath` / `cleanupTocPath` DOM orchestration

**Files:**
- Modify: `apps/docs/src/lib/toc-path.ts`
- Modify: `apps/docs/src/lib/__tests__/toc-path.test.ts`

This adds the DOM-dependent parts of toc-path.ts — the SVG creation, scroll tracking, and cleanup. These tests use happy-dom.

- [ ] **Step 1: Write failing tests for initTocPath and cleanupTocPath**

Append to `apps/docs/src/lib/__tests__/toc-path.test.ts`:

```typescript
import { initTocPath, cleanupTocPath } from '../toc-path';

describe('initTocPath', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    cleanupTocPath();
  });

  function buildToc(linkCount: number) {
    const tocEl = document.createElement('starlight-toc');
    const nav = document.createElement('nav');
    const ul = document.createElement('ul');
    for (let i = 0; i < linkCount; i++) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#heading-${i}`;
      a.textContent = `Heading ${i}`;
      li.appendChild(a);
      ul.appendChild(li);

      // Create the target heading element
      const heading = document.createElement('h2');
      heading.id = `heading-${i}`;
      document.body.appendChild(heading);
    }
    nav.appendChild(ul);
    tocEl.appendChild(nav);
    document.body.appendChild(tocEl);
    return ul;
  }

  it('does nothing when no starlight-toc element exists', () => {
    initTocPath();
    expect(document.querySelector('.toc-items-wrapper')).toBeNull();
  });

  it('does nothing when ToC has fewer than 2 links', () => {
    buildToc(1);
    initTocPath();
    expect(document.querySelector('.toc-items-wrapper')).toBeNull();
  });

  it('wraps the ToC list in a .toc-items-wrapper', () => {
    buildToc(3);
    initTocPath();
    const wrapper = document.querySelector('.toc-items-wrapper');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('ul')).not.toBeNull();
  });

  it('creates an SVG with bg and active paths', () => {
    buildToc(3);
    initTocPath();
    const svg = document.querySelector('.toc-path-svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    expect(svg!.querySelector('.toc-path-bg')).not.toBeNull();
    expect(svg!.querySelector('.toc-path-active')).not.toBeNull();
  });

  it('is idempotent — does not double-wrap on second call', () => {
    buildToc(3);
    initTocPath();
    initTocPath();
    const wrappers = document.querySelectorAll('.toc-items-wrapper');
    expect(wrappers.length).toBe(1);
  });

  it('marks the first link as active by default', () => {
    buildToc(3);
    initTocPath();
    const links = document.querySelectorAll('starlight-toc a');
    expect(links[0].classList.contains('toc-active')).toBe(true);
  });

  it('cleanupTocPath is safe to call when not initialized', () => {
    expect(() => cleanupTocPath()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd apps/docs && bun test src/lib/__tests__/toc-path.test.ts`
Expected: Pure function tests PASS, new DOM tests FAIL — `initTocPath is not a function`

- [ ] **Step 3: Implement initTocPath and cleanupTocPath**

Append to `apps/docs/src/lib/toc-path.ts` (after the pure functions):

```typescript
// ── DOM orchestration ─────────────────────────────────────────────

let cleanup: (() => void) | null = null;

/** Initialize the ToC SVG serpentine indicator and scroll tracking. */
export function initTocPath(): void {
  cleanup?.();
  cleanup = null;

  const toc = document.querySelector<HTMLElement>('starlight-toc nav > ul');
  if (!toc) return;

  const links = [...toc.querySelectorAll<HTMLAnchorElement>('a')];
  if (links.length < 2) return;

  // Already enhanced
  if (toc.parentElement?.classList.contains('toc-items-wrapper')) return;

  // Wrap in relative container
  const wrapper = document.createElement('div');
  wrapper.className = 'toc-items-wrapper';
  toc.parentNode!.insertBefore(wrapper, toc);
  wrapper.appendChild(toc);

  // Create SVG with background + active paths
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('toc-path-svg');
  svg.setAttribute('aria-hidden', 'true');

  const bgPath = document.createElementNS(ns, 'path');
  bgPath.classList.add('toc-path-bg');
  const activePath = document.createElementNS(ns, 'path');
  activePath.classList.add('toc-path-active');
  svg.append(bgPath, activePath);
  wrapper.prepend(svg);

  let points: Point[] = [];

  /** Measure link positions and build the SVG serpentine path. */
  function buildPath() {
    const wRect = wrapper.getBoundingClientRect();

    points = links.map((link) => {
      const rect = link.getBoundingClientRect();
      return {
        x: Math.max(2, rect.left - wRect.left - 8),
        y: rect.top - wRect.top + rect.height / 2,
      };
    });

    const svgW = Math.max(16, ...points.map((p) => p.x + 4));
    const svgH = wRect.height;
    svg.setAttribute('width', String(svgW));
    svg.setAttribute('height', String(svgH));
    svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);

    const d = buildSerpentinePath(points);
    bgPath.setAttribute('d', d);
    activePath.setAttribute('d', d);
  }

  buildPath();

  function getActiveLink(): HTMLAnchorElement {
    const headingTops = links.map((link) => {
      const id = decodeURIComponent(link.hash.slice(1));
      const el = document.getElementById(id);
      return el ? el.getBoundingClientRect().top : Infinity;
    });

    const idx = resolveActiveIndex(
      headingTops,
      window.scrollY,
      document.documentElement.scrollHeight,
      window.innerHeight,
    );
    return links[idx];
  }

  function update() {
    const activeLink = getActiveLink();

    links.forEach((l) => l.classList.remove('toc-active'));
    activeLink.classList.add('toc-active');

    const idx = links.indexOf(activeLink);
    if (idx >= 0 && points[idx]) {
      const clipY = points[idx].y + 4;
      activePath.style.clipPath = `polygon(0 0, 100% 0, 100% ${clipY}px, 0 ${clipY}px)`;
    }
  }

  update();

  // Rebuild on resize, track on scroll
  const ro = new ResizeObserver(() => {
    buildPath();
    update();
  });
  ro.observe(wrapper);

  const ac = new AbortController();
  let scrollTimer: ReturnType<typeof setTimeout>;
  window.addEventListener(
    'scroll',
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(update, 30);
    },
    { passive: true, signal: ac.signal },
  );

  cleanup = () => {
    ac.abort();
    ro.disconnect();
  };
}

/** Tear down scroll listener and ResizeObserver. Safe to call when not initialized. */
export function cleanupTocPath(): void {
  cleanup?.();
  cleanup = null;
}
```

- [ ] **Step 4: Run all toc-path tests**

Run: `cd apps/docs && bun test src/lib/__tests__/toc-path.test.ts`
Expected: All tests PASS (pure + DOM)

- [ ] **Step 5: Commit**

```bash
git add apps/docs/src/lib/toc-path.ts apps/docs/src/lib/__tests__/toc-path.test.ts
git commit -m "feat(docs): add ToC path DOM orchestration with tests"
```

---

### Task 5: Rewire Head.astro to use extracted modules

**Files:**
- Modify: `apps/docs/src/components/Head.astro:11-211`

- [ ] **Step 1: Replace the inline script in Head.astro**

The entire `<script>` block (lines 11-211) is replaced. The Astro frontmatter and non-script markup remain unchanged.

The new `Head.astro` should be:

```astro
---
import { ClientRouter } from 'astro:transitions';
import PostHog from './PostHog.astro';

const { head } = Astro.locals.starlightRoute;
---

{head.map(({ tag: Tag, attrs, content }) => <Tag {...attrs} set:html={content} />)}
<ClientRouter />
<PostHog />
<script>
  import { enhanceCodeBlocks } from '../lib/code-blocks';
  import { initTocPath, cleanupTocPath } from '../lib/toc-path';

  enhanceCodeBlocks();
  initTocPath();

  document.addEventListener('astro:before-swap', cleanupTocPath);
  document.addEventListener('astro:after-swap', () => {
    enhanceCodeBlocks();
    requestAnimationFrame(initTocPath);
  });
</script>
```

- [ ] **Step 2: Run all tests to verify nothing broke**

Run: `cd apps/docs && bun test`
Expected: All tests PASS

- [ ] **Step 3: Type-check the docs app**

Run: `cd apps/docs && npx astro check`
Expected: No type errors

- [ ] **Step 4: Build the docs app to verify Astro bundles correctly**

Run: `nx build @maelstrom-co/docs` (or `cd apps/docs && npx astro build`)
Expected: Build completes without errors

- [ ] **Step 5: Commit**

```bash
git add apps/docs/src/components/Head.astro
git commit -m "refactor(docs): rewire Head.astro to use extracted modules"
```

---

### Task 6: Final verification and cleanup

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd apps/docs && bun test`
Expected: All tests pass — pure functions and DOM tests

- [ ] **Step 2: Run the dev server and manually verify**

Run: `nx serve @maelstrom-co/docs` (or `cd apps/docs && npx astro dev`)

Verify in browser:
- Code blocks have copy buttons
- Code blocks with `title="..."` have title bars
- Copy button copies code to clipboard and shows checkmark
- ToC sidebar shows serpentine SVG path
- Active heading updates on scroll
- Active heading near bottom of page correctly expands
- Navigate between pages (view transitions) — enhancements re-apply
- No console errors

- [ ] **Step 3: Commit any fixes discovered during manual testing**

Only if needed — no empty commits.
