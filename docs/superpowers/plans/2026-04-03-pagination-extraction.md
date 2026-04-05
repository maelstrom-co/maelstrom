# Pagination.astro Module Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Pagination.astro's inline script into two focused modules (`page-feedback.ts`, `copy-for-ai.ts`) with tests, reusing the shared `preferences.ts` module.

**Architecture:** Two modules under `apps/docs/src/lib/`: `page-feedback.ts` (self-registering `<page-feedback>` custom element using shared preferences) and `copy-for-ai.ts` (pure `domToMarkdown` function + clipboard handler setup). Pagination.astro's `<script>` becomes two imports.

**Tech Stack:** Bun test runner (`bun:test`), jsdom for DOM environment, existing test infrastructure.

---

## File Structure

```
apps/docs/src/
  lib/
    copy-for-ai.ts                          — CREATE (~50 LOC)
    page-feedback.ts                        — CREATE (~45 LOC)
    __tests__/
      copy-for-ai.test.ts                  — CREATE
      page-feedback.test.ts                — CREATE
  components/
    Pagination.astro                        — MODIFY (replace 85-line script with 2-line import)
```

---

### Task 1: TDD `domToMarkdown` and copy-for-ai module

**Files:**
- Create: `apps/docs/src/lib/copy-for-ai.ts`
- Create: `apps/docs/src/lib/__tests__/copy-for-ai.test.ts`

The `domToMarkdown` function is pure (DOM in, string out) — the most valuable thing to test.

- [ ] **Step 1: Write failing tests**

Create `apps/docs/src/lib/__tests__/copy-for-ai.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { domToMarkdown, initCopyForAi } from '../copy-for-ai';

describe('domToMarkdown', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function buildContent(html: string): Element {
    const div = document.createElement('div');
    div.classList.add('sl-markdown-content');
    div.innerHTML = html;
    document.body.appendChild(div);
    return div;
  }

  it('converts headings to markdown with correct levels', () => {
    const el = buildContent('<h2>Section</h2><h3>Subsection</h3>');
    const md = domToMarkdown(el);
    expect(md).toContain('## Section');
    expect(md).toContain('### Subsection');
  });

  it('converts paragraphs to plain text', () => {
    const el = buildContent('<p>Hello world</p>');
    const md = domToMarkdown(el);
    expect(md).toContain('Hello world');
  });

  it('converts list items with dashes', () => {
    const el = buildContent('<ul><li>First</li><li>Second</li></ul>');
    const md = domToMarkdown(el);
    expect(md).toContain('- First');
    expect(md).toContain('- Second');
  });

  it('converts code blocks with language', () => {
    const el = buildContent('<pre><code class="language-ts">const x = 1;</code></pre>');
    const md = domToMarkdown(el);
    expect(md).toContain('```ts');
    expect(md).toContain('const x = 1;');
    expect(md).toContain('```');
  });

  it('converts code blocks without language', () => {
    const el = buildContent('<pre><code>plain code</code></pre>');
    const md = domToMarkdown(el);
    expect(md).toContain('```');
    expect(md).toContain('plain code');
  });

  it('converts blockquotes', () => {
    const el = buildContent('<blockquote>Important note</blockquote>');
    const md = domToMarkdown(el);
    expect(md).toContain('> Important note');
  });

  it('handles mixed content', () => {
    const el = buildContent(`
      <h2>Title</h2>
      <p>Some text</p>
      <ul><li>Item one</li></ul>
      <pre><code class="language-js">alert(1)</code></pre>
    `);
    const md = domToMarkdown(el);
    expect(md).toContain('## Title');
    expect(md).toContain('Some text');
    expect(md).toContain('- Item one');
    expect(md).toContain('```js');
    expect(md).toContain('alert(1)');
  });

  it('collapses excessive blank lines', () => {
    const el = buildContent('<p>A</p><p></p><p></p><p>B</p>');
    const md = domToMarkdown(el);
    // Should not have 3+ consecutive newlines
    expect(md).not.toMatch(/\n{3,}/);
  });

  it('returns empty string for empty content', () => {
    const el = buildContent('');
    const md = domToMarkdown(el);
    expect(md.trim()).toBe('');
  });
});

describe('initCopyForAi', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not throw when no .copy-for-ai-btn exists', () => {
    expect(() => initCopyForAi()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/docs && bun test src/lib/__tests__/copy-for-ai.test.ts`
Expected: FAIL — `Cannot find module '../copy-for-ai'`

- [ ] **Step 3: Implement copy-for-ai module**

Create `apps/docs/src/lib/copy-for-ai.ts`:

```typescript
/** Convert a DOM element's content to a markdown string. */
export function domToMarkdown(root: Element): string {
  const lines: string[] = [];

  root
    .querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre code, blockquote')
    .forEach((el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'code' && el.parentElement?.tagName === 'PRE') {
        const lang = el.className?.match(/language-(\w+)/)?.[1] || '';
        lines.push('```' + lang, el.textContent?.trim() || '', '```', '');
      } else if (tag.startsWith('h')) {
        const level = '#'.repeat(parseInt(tag[1]));
        lines.push(`${level} ${el.textContent?.trim()}`, '');
      } else if (tag === 'li') {
        lines.push(`- ${el.textContent?.trim()}`);
      } else if (tag === 'blockquote') {
        lines.push(`> ${el.textContent?.trim()}`, '');
      } else {
        lines.push(el.textContent?.trim() || '', '');
      }
    });

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Attach click handlers to all `.copy-for-ai-btn` elements on the page. */
export function initCopyForAi(): void {
  document.querySelectorAll('.copy-for-ai-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const content = document.querySelector('.sl-markdown-content');
      if (!content) return;

      const title = document.querySelector('h1')?.textContent?.trim() || '';
      const url = window.location.href;

      const markdown = `# ${title}\nSource: ${url}\n\n${domToMarkdown(content)}`;

      try {
        await navigator.clipboard.writeText(markdown);
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
        setTimeout(() => {
          btn.innerHTML = original;
        }, 2000);
      } catch {
        const original = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Copy failed`;
        setTimeout(() => {
          btn.innerHTML = original;
        }, 2000);
      }
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/docs && bun test src/lib/__tests__/copy-for-ai.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
jj describe -m "feat(docs): add copy-for-ai module with domToMarkdown tests"
```

---

### Task 2: TDD PageFeedback custom element

**Files:**
- Create: `apps/docs/src/lib/page-feedback.ts`
- Create: `apps/docs/src/lib/__tests__/page-feedback.test.ts`

This self-registering custom element uses the shared `preferences.ts` module.

- [ ] **Step 1: Write failing tests**

Create `apps/docs/src/lib/__tests__/page-feedback.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import '../page-feedback';

describe('PageFeedback custom element', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  function buildFeedback(pageId = 'test-page') {
    const el = document.createElement('page-feedback');
    el.classList.add('page-feedback');
    el.setAttribute('data-page-id', pageId);
    el.innerHTML = `
      <button class="feedback-btn" data-value="good" type="button">Good</button>
      <button class="feedback-btn" data-value="bad" type="button">Bad</button>
    `;
    document.body.appendChild(el);
    return el;
  }

  it('restores saved feedback on connect', () => {
    localStorage.setItem('feedback:test-page', 'good');
    const el = buildFeedback();

    const goodBtn = el.querySelector('[data-value="good"]');
    expect(goodBtn!.getAttribute('data-selected')).toBe('true');
  });

  it('does not select any button when no feedback is saved', () => {
    const el = buildFeedback();

    const selected = el.querySelector('[data-selected="true"]');
    expect(selected).toBeNull();
  });

  it('selects button and saves to localStorage on click', () => {
    const el = buildFeedback();
    const goodBtn = el.querySelector('[data-value="good"]') as HTMLElement;

    goodBtn.click();

    expect(goodBtn.getAttribute('data-selected')).toBe('true');
    expect(localStorage.getItem('feedback:test-page')).toBe('good');
  });

  it('deselects previous button when clicking a different one', () => {
    const el = buildFeedback();
    const goodBtn = el.querySelector('[data-value="good"]') as HTMLElement;
    const badBtn = el.querySelector('[data-value="bad"]') as HTMLElement;

    goodBtn.click();
    badBtn.click();

    expect(goodBtn.getAttribute('data-selected')).toBeNull();
    expect(badBtn.getAttribute('data-selected')).toBe('true');
    expect(localStorage.getItem('feedback:test-page')).toBe('bad');
  });

  it('cleans up event listeners on disconnect', () => {
    const el = buildFeedback();
    expect(() => el.remove()).not.toThrow();
  });

  it('uses page ID from data attribute for localStorage key', () => {
    const el = buildFeedback('custom-page-id');
    const goodBtn = el.querySelector('[data-value="good"]') as HTMLElement;

    goodBtn.click();

    expect(localStorage.getItem('feedback:custom-page-id')).toBe('good');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/docs && bun test src/lib/__tests__/page-feedback.test.ts`
Expected: FAIL — `Cannot find module '../page-feedback'`

- [ ] **Step 3: Implement PageFeedback module**

Create `apps/docs/src/lib/page-feedback.ts`:

```typescript
import { safeGetItem, safeSetItem } from './preferences';

class PageFeedback extends HTMLElement {
  #ac = new AbortController();

  connectedCallback() {
    this.#ac = new AbortController();
    const { signal } = this.#ac;
    const pageId = this.dataset.pageId;
    const stored = safeGetItem(`feedback:${pageId}`);

    if (stored) {
      const btn = this.querySelector(`[data-value="${stored}"]`);
      if (btn) btn.setAttribute('data-selected', 'true');
    }

    this.querySelectorAll('.feedback-btn').forEach((btn) => {
      btn.addEventListener(
        'click',
        () => {
          const value = (btn as HTMLElement).dataset.value;
          this.querySelectorAll('.feedback-btn').forEach((b) =>
            b.removeAttribute('data-selected'),
          );
          btn.setAttribute('data-selected', 'true');
          safeSetItem(`feedback:${pageId}`, value || '');

          if (typeof window.posthog?.capture === 'function') {
            window.posthog.capture('on_rate_docs', {
              page: pageId,
              rating: value,
              url: window.location.pathname,
            });
          }
        },
        { signal },
      );
    });
  }

  disconnectedCallback() {
    this.#ac.abort();
  }
}

customElements.define('page-feedback', PageFeedback);
```

**Note:** The `window.posthog` reference requires a type declaration. Check if `apps/docs/src/env.d.ts` already declares it. If so, no changes needed. If not, the type will be inferred as `any` which is fine for this usage.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/docs && bun test src/lib/__tests__/page-feedback.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run all tests**

Run: `cd apps/docs && bun test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```
jj new -m "feat(docs): add PageFeedback custom element with tests"
```

---

### Task 3: Rewire Pagination.astro

**Files:**
- Modify: `apps/docs/src/components/Pagination.astro:62-147`

- [ ] **Step 1: Replace the inline script in Pagination.astro**

Replace the entire `<script>` block (lines 62-147) with:

```html
<script>
  import '../lib/page-feedback';
  import { initCopyForAi } from '../lib/copy-for-ai';
  initCopyForAi();
</script>
```

The Astro frontmatter, template, and `<style>` block remain unchanged.

- [ ] **Step 2: Run all tests**

Run: `cd apps/docs && bun test`
Expected: All tests PASS

- [ ] **Step 3: Type-check**

Run: `cd apps/docs && npx astro check`
Expected: 0 errors

- [ ] **Step 4: Build**

Run: `cd apps/docs && npx astro build`
Expected: Vite builds successfully

- [ ] **Step 5: Commit**

```
jj new -m "refactor(docs): rewire Pagination.astro to use extracted modules"
```

---

### Task 4: Manual verification

**Files:** None (verification only)

- [ ] **Step 1: Start dev server and verify in browser**

Check:
- "Was this page helpful?" buttons work (Good/Bad)
- Feedback persists across page navigations
- Feedback persists across full page reloads
- "Copy for AI" copies page content as markdown
- Copied markdown includes title, source URL, headings, paragraphs, code blocks, lists
- No console errors
- Navigate between pages (view transitions) — feedback + copy buttons re-appear
