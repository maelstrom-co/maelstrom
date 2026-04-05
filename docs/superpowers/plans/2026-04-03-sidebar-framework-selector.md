# Sidebar Framework Selector Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Sidebar.astro's 165-line inline script into a shared preferences module and a self-registering framework selector custom element, with full test coverage.

**Architecture:** Two modules under `apps/docs/src/lib/`: `preferences.ts` (shared localStorage wrapper) and `framework-selector.ts` (self-registering custom element with label maps and Starlight tab sync). Sidebar.astro's `<script>` becomes a single import.

**Tech Stack:** Bun test runner (`bun:test`), jsdom for DOM environment, existing test infrastructure from Head.astro refactor.

---

## File Structure

```
apps/docs/src/
  lib/
    preferences.ts                          — CREATE (~10 LOC)
    framework-selector.ts                   — CREATE (~155 LOC)
    __tests__/
      preferences.test.ts                   — CREATE
      framework-selector.test.ts            — CREATE
  components/
    Sidebar.astro                           — MODIFY (replace 165-line script with 1-line import)
```

---

### Task 1: TDD shared preferences module

**Files:**
- Create: `apps/docs/src/lib/preferences.ts`
- Create: `apps/docs/src/lib/__tests__/preferences.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/docs/src/lib/__tests__/preferences.test.ts`:

```typescript
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { safeGetItem, safeSetItem } from '../preferences';

describe('safeGetItem', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the stored value', () => {
    localStorage.setItem('test-key', 'test-value');
    expect(safeGetItem('test-key')).toBe('test-value');
  });

  it('returns null for missing keys', () => {
    expect(safeGetItem('nonexistent')).toBeNull();
  });

  it('returns null when localStorage throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('storage unavailable'); };
    expect(safeGetItem('any')).toBeNull();
    Storage.prototype.getItem = original;
  });
});

describe('safeSetItem', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes the value to localStorage', () => {
    safeSetItem('test-key', 'test-value');
    expect(localStorage.getItem('test-key')).toBe('test-value');
  });

  it('does not throw when localStorage throws', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('storage unavailable'); };
    expect(() => safeSetItem('any', 'val')).not.toThrow();
    Storage.prototype.setItem = original;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/docs && bun test src/lib/__tests__/preferences.test.ts`
Expected: FAIL — `Cannot find module '../preferences'`

- [ ] **Step 3: Implement preferences module**

Create `apps/docs/src/lib/preferences.ts`:

```typescript
/** Read from localStorage, returning null if storage is unavailable. */
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write to localStorage, silently failing if storage is unavailable. */
export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/docs && bun test src/lib/__tests__/preferences.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
jj describe -m "feat(docs): add shared preferences module with tests"
```

---

### Task 2: TDD framework selector module — syncStarlightTabs and label maps

**Files:**
- Create: `apps/docs/src/lib/framework-selector.ts`
- Create: `apps/docs/src/lib/__tests__/framework-selector.test.ts`

This task creates the module with the label maps and `syncStarlightTabs`. The `FrameworkSelector` custom element is added in Task 3.

- [ ] **Step 1: Write failing tests**

Create `apps/docs/src/lib/__tests__/framework-selector.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  FRAMEWORK_LABELS,
  LABEL_TO_FRAMEWORK,
  syncStarlightTabs,
} from '../framework-selector';

describe('FRAMEWORK_LABELS', () => {
  it('maps framework IDs to display labels', () => {
    expect(FRAMEWORK_LABELS.react).toBe('React');
    expect(FRAMEWORK_LABELS.vanilla).toBe('Vanilla JS');
    expect(FRAMEWORK_LABELS.solid).toBe('Solid');
  });
});

describe('LABEL_TO_FRAMEWORK', () => {
  it('maps display labels back to framework IDs', () => {
    expect(LABEL_TO_FRAMEWORK['React']).toBe('react');
    expect(LABEL_TO_FRAMEWORK['Vanilla JS']).toBe('vanilla');
    expect(LABEL_TO_FRAMEWORK['Solid']).toBe('solid');
  });
});

describe('syncStarlightTabs', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function buildTabGroup(labels: string[], activeIndex = 0) {
    const tabGroup = document.createElement('starlight-tabs');
    tabGroup.setAttribute('data-sync-key', 'framework');

    labels.forEach((label, i) => {
      const tab = document.createElement('button');
      tab.setAttribute('role', 'tab');
      tab.textContent = label;
      tab.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
      tab.setAttribute('tabindex', i === activeIndex ? '0' : '-1');
      tabGroup.appendChild(tab);
    });

    labels.forEach((_, i) => {
      const panel = document.createElement('div');
      panel.setAttribute('role', 'tabpanel');
      panel.hidden = i !== activeIndex;
      tabGroup.appendChild(panel);
    });

    document.body.appendChild(tabGroup);
    return tabGroup;
  }

  it('switches the active tab by label', () => {
    buildTabGroup(['React', 'Vanilla JS', 'Solid']);
    syncStarlightTabs('Vanilla JS');

    const tabs = document.querySelectorAll('[role="tab"]');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[2].getAttribute('aria-selected')).toBe('false');
  });

  it('shows the matching panel and hides others', () => {
    buildTabGroup(['React', 'Vanilla JS']);
    syncStarlightTabs('Vanilla JS');

    const panels = document.querySelectorAll('[role="tabpanel"]');
    expect((panels[0] as HTMLElement).hidden).toBe(true);
    expect((panels[1] as HTMLElement).hidden).toBe(false);
  });

  it('sets correct tabindex on tabs', () => {
    buildTabGroup(['React', 'Vanilla JS']);
    syncStarlightTabs('Vanilla JS');

    const tabs = document.querySelectorAll('[role="tab"]');
    expect(tabs[0].getAttribute('tabindex')).toBe('-1');
    expect(tabs[1].getAttribute('tabindex')).toBe('0');
  });

  it('does nothing when label does not match any tab', () => {
    buildTabGroup(['React', 'Vanilla JS']);
    syncStarlightTabs('Nonexistent');

    const tabs = document.querySelectorAll('[role="tab"]');
    // Original state preserved (React active at index 0)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('does nothing when no starlight-tabs elements exist', () => {
    expect(() => syncStarlightTabs('React')).not.toThrow();
  });

  it('syncs multiple tab groups on the same page', () => {
    buildTabGroup(['React', 'Vanilla JS']);
    buildTabGroup(['React', 'Vanilla JS']);

    syncStarlightTabs('Vanilla JS');

    const allTabs = document.querySelectorAll('[role="tab"]');
    // Both tab groups should have Vanilla JS selected
    expect(allTabs[1].getAttribute('aria-selected')).toBe('true');
    expect(allTabs[3].getAttribute('aria-selected')).toBe('true');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/docs && bun test src/lib/__tests__/framework-selector.test.ts`
Expected: FAIL — `Cannot find module '../framework-selector'`

- [ ] **Step 3: Implement label maps and syncStarlightTabs**

Create `apps/docs/src/lib/framework-selector.ts`:

```typescript
import { safeGetItem, safeSetItem } from './preferences';

export const FRAMEWORK_LABELS: Record<string, string> = {
  react: 'React',
  vanilla: 'Vanilla JS',
  solid: 'Solid',
};

export const LABEL_TO_FRAMEWORK: Record<string, string> = Object.fromEntries(
  Object.entries(FRAMEWORK_LABELS).map(([k, v]) => [v, k]),
);

/** Switch visible Starlight <Tabs syncKey="framework"> without stealing focus. */
export function syncStarlightTabs(label: string) {
  document
    .querySelectorAll('starlight-tabs[data-sync-key="framework"]')
    .forEach((tabGroup) => {
      const tabs = [
        ...tabGroup.querySelectorAll<HTMLElement>('[role="tab"]'),
      ];
      const panels = [
        ...tabGroup.querySelectorAll<HTMLElement>(':scope > [role="tabpanel"]'),
      ];
      const idx = tabs.findIndex((t) => t.textContent?.trim() === label);
      if (idx < 0) return;
      tabs.forEach((tab, i) => {
        tab.setAttribute('aria-selected', i === idx ? 'true' : 'false');
        tab.setAttribute('tabindex', i === idx ? '0' : '-1');
      });
      panels.forEach((panel, i) => {
        panel.hidden = i !== idx;
      });
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/docs && bun test src/lib/__tests__/framework-selector.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run all tests**

Run: `cd apps/docs && bun test`
Expected: All tests PASS (preferences + framework-selector + existing Head.astro tests)

- [ ] **Step 6: Commit**

```
jj new -m "feat(docs): add framework selector label maps and tab sync with tests"
```

---

### Task 3: TDD FrameworkSelector custom element

**Files:**
- Modify: `apps/docs/src/lib/framework-selector.ts`
- Modify: `apps/docs/src/lib/__tests__/framework-selector.test.ts`

This task adds the `FrameworkSelector` custom element class and its self-registration. Append to existing files.

- [ ] **Step 1: Write failing tests for the custom element**

Append to `apps/docs/src/lib/__tests__/framework-selector.test.ts`:

```typescript
describe('FrameworkSelector custom element', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  /** Build a <framework-selector> element matching Sidebar.astro's template. */
  function buildSelector() {
    const el = document.createElement('framework-selector');
    el.classList.add('framework-selector');
    el.innerHTML = `
      <button type="button" class="framework-trigger" aria-expanded="false" aria-haspopup="listbox">
        <span class="framework-icon"></span>
        <span class="framework-label">React</span>
        <span class="framework-chevron"></span>
      </button>
      <ul class="framework-menu" role="listbox" aria-label="Select framework">
        <li role="option" data-framework="react" aria-selected="true">
          <span class="fw-option-icon">R</span>
          <span class="fw-option-label">React</span>
        </li>
        <li role="option" data-framework="vanilla" aria-selected="false">
          <span class="fw-option-icon">V</span>
          <span class="fw-option-label">Vanilla JS</span>
        </li>
        <li role="option" data-framework="solid" aria-selected="false" class="coming-soon">
          <span class="fw-option-icon">S</span>
          <span class="fw-option-label">Solid</span>
          <span class="badge-soon">Soon</span>
        </li>
      </ul>
    `;
    document.body.appendChild(el);
    return el;
  }

  it('loads saved framework preference on connect', () => {
    localStorage.setItem('maelstrom-framework', 'vanilla');
    const el = buildSelector();

    const label = el.querySelector('.framework-label');
    expect(label!.textContent).toBe('Vanilla JS');
  });

  it('defaults to react when no preference is saved', () => {
    const el = buildSelector();

    const selected = el.querySelector('[aria-selected="true"]');
    expect((selected as HTMLElement).dataset.framework).toBe('react');
  });

  it('syncs preference to Starlight tabs localStorage key on connect', () => {
    localStorage.setItem('maelstrom-framework', 'vanilla');
    buildSelector();

    expect(localStorage.getItem('starlight-synced-tabs__framework')).toBe('Vanilla JS');
  });

  it('opens menu on trigger click', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;

    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes menu on second trigger click', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;

    trigger.click();
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('selects framework on option click', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;
    trigger.click(); // open menu

    const vanillaOption = el.querySelector('[data-framework="vanilla"]') as HTMLElement;
    vanillaOption.click();

    expect(el.querySelector('.framework-label')!.textContent).toBe('Vanilla JS');
    expect(vanillaOption.getAttribute('aria-selected')).toBe('true');
    expect(localStorage.getItem('maelstrom-framework')).toBe('vanilla');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('excludes coming-soon options from interactive options', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;
    trigger.click();

    const solidOption = el.querySelector('[data-framework="solid"]') as HTMLElement;
    solidOption.click();

    // Should NOT change — solid is coming-soon
    expect(el.querySelector('.framework-label')!.textContent).not.toBe('Solid');
  });

  it('closes menu on Escape key', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;
    trigger.click();

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens menu on ArrowDown when closed', () => {
    const el = buildSelector();
    const trigger = el.querySelector('.framework-trigger') as HTMLElement;

    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('cleans up event listeners on disconnect', () => {
    const el = buildSelector();
    // Disconnect should not throw
    expect(() => el.remove()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd apps/docs && bun test src/lib/__tests__/framework-selector.test.ts`
Expected: Label map and syncStarlightTabs tests PASS, custom element tests FAIL

- [ ] **Step 3: Implement FrameworkSelector custom element**

Append to `apps/docs/src/lib/framework-selector.ts`:

```typescript
class FrameworkSelector extends HTMLElement {
  #ac = new AbortController();

  connectedCallback() {
    this.#ac = new AbortController();
    const { signal } = this.#ac;
    const trigger = this.querySelector('.framework-trigger') as HTMLButtonElement;
    const menu = this.querySelector('.framework-menu') as HTMLUListElement;
    const options = [
      ...menu.querySelectorAll<HTMLLIElement>('li:not(.coming-soon)'),
    ];

    // Make options focusable
    options.forEach((item) => item.setAttribute('tabindex', '-1'));

    // Load saved preference and sync to Starlight tabs localStorage
    const saved = safeGetItem('maelstrom-framework') || 'react';
    this.#selectFramework(saved);
    const savedLabel = FRAMEWORK_LABELS[saved];
    if (savedLabel) {
      safeSetItem('starlight-synced-tabs__framework', savedLabel);
    }

    const open = () => trigger.setAttribute('aria-expanded', 'true');
    const close = () => trigger.setAttribute('aria-expanded', 'false');
    const isOpen = () => trigger.getAttribute('aria-expanded') === 'true';

    const pick = (fw: string) => {
      this.#selectFramework(fw);
      close();
      trigger.focus();
      safeSetItem('maelstrom-framework', fw);
      const label = FRAMEWORK_LABELS[fw];
      if (label) {
        safeSetItem('starlight-synced-tabs__framework', label);
        syncStarlightTabs(label);
      }
    };

    // Toggle menu
    trigger.addEventListener(
      'click',
      () => (isOpen() ? close() : open()),
      { signal },
    );

    // Select framework from sidebar dropdown
    options.forEach((item) => {
      item.addEventListener(
        'click',
        () => pick(item.dataset.framework || 'react'),
        { signal },
      );
    });

    // Keyboard navigation inside the listbox
    this.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          close();
          trigger.focus();
          return;
        }

        if (!isOpen()) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            open();
            options[0]?.focus();
          }
          return;
        }

        const focusedIdx = options.indexOf(
          document.activeElement as HTMLLIElement,
        );

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = focusedIdx < options.length - 1 ? focusedIdx + 1 : 0;
          options[next]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = focusedIdx > 0 ? focusedIdx - 1 : options.length - 1;
          options[prev]?.focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (focusedIdx >= 0)
            pick(options[focusedIdx].dataset.framework || 'react');
        } else if (e.key === 'Home') {
          e.preventDefault();
          options[0]?.focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          options[options.length - 1]?.focus();
        }
      },
      { signal },
    );

    // Reverse bridge: when user clicks a Starlight framework tab, update sidebar
    document.addEventListener(
      'click',
      (e) => {
        const tab = (e.target as HTMLElement).closest?.(
          'starlight-tabs[data-sync-key="framework"] [role="tab"]',
        );
        if (!tab) return;
        const label = tab.textContent?.trim() || '';
        const fw = LABEL_TO_FRAMEWORK[label];
        if (fw) {
          this.#selectFramework(fw);
          safeSetItem('maelstrom-framework', fw);
        }
      },
      { signal },
    );

    // Close on outside click
    document.addEventListener(
      'click',
      (e) => {
        if (!this.contains(e.target as Node)) close();
      },
      { signal },
    );
  }

  disconnectedCallback() {
    this.#ac.abort();
  }

  #selectFramework(fw: string) {
    const label = this.querySelector('.framework-label');
    const triggerIcon = this.querySelector('.framework-icon');
    const items = this.querySelectorAll('.framework-menu li');

    items.forEach((item) => {
      const isCurrent = (item as HTMLElement).dataset.framework === fw;
      item.setAttribute('aria-selected', String(isCurrent));
      if (isCurrent && label) {
        const optLabel = item.querySelector('.fw-option-label');
        label.textContent = optLabel?.textContent || fw;
        const itemIcon = item.querySelector('.fw-option-icon');
        if (itemIcon && triggerIcon) {
          triggerIcon.innerHTML = itemIcon.innerHTML;
        }
      }
    });
  }
}

customElements.define('framework-selector', FrameworkSelector);
```

- [ ] **Step 4: Run all framework-selector tests**

Run: `cd apps/docs && bun test src/lib/__tests__/framework-selector.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```
jj new -m "feat(docs): add FrameworkSelector custom element with tests"
```

---

### Task 4: Rewire Sidebar.astro

**Files:**
- Modify: `apps/docs/src/components/Sidebar.astro:318-482`

- [ ] **Step 1: Replace the inline script in Sidebar.astro**

Replace the entire `<script>` block (lines 318-482) with:

```html
<script>
  import '../lib/framework-selector';
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
Expected: Vite builds successfully (font fetch may fail — that's a pre-existing network issue, not ours)

- [ ] **Step 5: Commit**

```
jj new -m "refactor(docs): rewire Sidebar.astro to use extracted modules"
```

---

### Task 5: Manual verification

**Files:** None (verification only)

- [ ] **Step 1: Start dev server**

Run: `nx serve @maelstrom-co/docs` (or `cd apps/docs && npx astro dev`)

- [ ] **Step 2: Verify in browser**

Check the following:
- Framework selector dropdown opens/closes on click
- Selecting "Vanilla JS" updates the sidebar label and icon
- Framework preference persists across page navigations (view transitions)
- Framework preference persists across full page reloads
- Keyboard navigation: ArrowDown opens dropdown, arrows cycle options, Enter selects, Escape closes
- Coming-soon options (Solid) are not selectable
- On a page with `<Tabs syncKey="framework">`, selecting in sidebar switches the tab content
- Clicking a Starlight framework tab updates the sidebar dropdown
- No console errors
