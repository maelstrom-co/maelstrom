import { beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  applyStoredState,
  COLLAPSED_ATTRIBUTE,
  initSidebarCollapse,
  isCollapsed,
  SIDEBAR_COLLAPSED_KEY,
  toggleCollapsed,
} from '../sidebar-collapse';

function renderToggles() {
  document.body.innerHTML = `
    <button type="button" data-sidebar-toggle="collapse" aria-expanded="true"></button>
    <button type="button" data-sidebar-toggle="expand" aria-expanded="true"></button>
  `;
}

function press(
  target: EventTarget,
  init: Partial<KeyboardEventInit> & { key: string },
) {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.documentElement.removeAttribute(COLLAPSED_ATTRIBUTE);
  renderToggles();
  initSidebarCollapse();
});

describe('stored state', () => {
  it('starts expanded when nothing is stored', () => {
    applyStoredState();
    expect(isCollapsed()).toBe(false);
  });

  it('restores a collapsed preference', () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    applyStoredState();
    expect(isCollapsed()).toBe(true);
  });

  // Reading the preference must not rewrite it: a reader who never touches the
  // toggle should not accumulate storage writes on every page view.
  it('does not write storage when only applying stored state', () => {
    applyStoredState();
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBeNull();
  });

  it('persists both directions of an explicit toggle', () => {
    toggleCollapsed();
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('true');
    toggleCollapsed();
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false');
  });

  // Astro's ClientRouter copies the incoming document's <html> attributes over
  // the live ones, which silently drops focus mode on every in-article link.
  it('re-applies the stored state after a view transition', () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    document.documentElement.removeAttribute(COLLAPSED_ATTRIBUTE);
    document.dispatchEvent(new Event('astro:after-swap'));
    expect(isCollapsed()).toBe(true);
  });
});

describe('toggle buttons', () => {
  it('toggles when a toggle button is clicked', () => {
    document
      .querySelector<HTMLButtonElement>('[data-sidebar-toggle="collapse"]')
      ?.click();
    expect(isCollapsed()).toBe(true);
  });

  // Both buttons control the same sidebar, so both must report its real state
  // to assistive technology, not the state of the button itself.
  it('syncs aria-expanded on every toggle button', () => {
    toggleCollapsed();
    const values = [...document.querySelectorAll('[data-sidebar-toggle]')].map(
      (button) => button.getAttribute('aria-expanded'),
    );
    expect(values).toEqual(['false', 'false']);
  });

  // Activating a toggle hides it. Without the hand-off, keyboard focus falls
  // back to <body> and the reader loses their place in the tab order.
  it('hands focus to the button that replaced the one used', () => {
    const collapseButton = document.querySelector<HTMLButtonElement>(
      '[data-sidebar-toggle="collapse"]',
    );
    collapseButton?.focus();
    collapseButton?.click();
    expect(document.activeElement?.getAttribute('data-sidebar-toggle')).toBe(
      'expand',
    );
  });

  it('leaves focus alone when the shortcut drives the toggle', () => {
    press(document, { key: 'b', metaKey: true });
    expect(document.activeElement).toBe(document.body);
  });
});

describe('keyboard shortcut', () => {
  it('toggles on Meta+B', () => {
    const event = press(document, { key: 'b', metaKey: true });
    expect(isCollapsed()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('toggles on Ctrl+B', () => {
    press(document, { key: 'b', ctrlKey: true });
    expect(isCollapsed()).toBe(true);
  });

  // Typing "b" in the search box must not move the layout out from under the
  // reader mid-query.
  it('ignores the shortcut while typing in a field', () => {
    const input = document.createElement('input');
    document.body.append(input);
    press(input, { key: 'b', metaKey: true });
    expect(isCollapsed()).toBe(false);
  });

  it('ignores the shortcut inside a dialog', () => {
    const dialog = document.createElement('dialog');
    const inner = document.createElement('div');
    dialog.append(inner);
    document.body.append(dialog);
    press(inner, { key: 'b', metaKey: true });
    expect(isCollapsed()).toBe(false);
  });

  // Ctrl+Alt+B and friends belong to the OS and to other tools; only the bare
  // Mod chord is ours.
  it('ignores the chord when Alt is held', () => {
    press(document, { key: 'b', metaKey: true, altKey: true });
    expect(isCollapsed()).toBe(false);
  });

  it('ignores an unmodified b', () => {
    press(document, { key: 'b' });
    expect(isCollapsed()).toBe(false);
  });
});

describe('pre-paint script', () => {
  const head = readFileSync(
    new URL('../../components/Head.astro', import.meta.url),
    'utf8',
  );

  it('uses the same storage key as this module', () => {
    expect(head).toContain(SIDEBAR_COLLAPSED_KEY);
  });

  it('uses the same attribute as this module', () => {
    expect(head).toContain(COLLAPSED_ATTRIBUTE);
  });
});
