import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ANIMATING_ATTRIBUTE,
  ANIMATION_FALLBACK_MS,
  applyStoredState,
  COLLAPSED_ATTRIBUTE,
  HAS_SIDEBAR_ATTRIBUTE,
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
  // Fake timers for the whole file, not just the marker tests: every toggle
  // schedules a real 260ms fallback, and one left pending by an earlier test
  // fires mid-test later on and clears the marker under an assertion.
  vi.useFakeTimers();
  document.documentElement.removeAttribute(COLLAPSED_ATTRIBUTE);
  document.documentElement.removeAttribute(ANIMATING_ATTRIBUTE);
  // Starlight sets this on every page that rendered a sidebar, so the default
  // fixture is a docs page. The tests that drop it are testing the pages that
  // have none.
  document.documentElement.setAttribute(HAS_SIDEBAR_ATTRIBUTE, '');
  renderToggles();
  initSidebarCollapse();
});

afterEach(() => {
  vi.useRealTimers();
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

  // Cmd/Ctrl+Shift+B is the browser's own bookmarks-bar toggle. Claiming it —
  // and calling preventDefault on it — steals a shortcut readers already have.
  it('ignores the chord when Shift is held', () => {
    const event = press(document, { key: 'b', metaKey: true, shiftKey: true });
    expect(isCollapsed()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  // Holding the chord auto-repeats. Without this guard the sidebar toggles
  // once per repeat and every toggle restarts the animation marker.
  it('ignores auto-repeat while the chord is held', () => {
    press(document, { key: 'b', metaKey: true });
    expect(isCollapsed()).toBe(true);

    press(document, { key: 'b', metaKey: true, repeat: true });
    expect(isCollapsed()).toBe(true);
  });

  it('ignores an unmodified b', () => {
    press(document, { key: 'b' });
    expect(isCollapsed()).toBe(false);
  });
});

// Splash pages and the 404 route render Starlight's header — and so the
// floating expand button — with no sidebar behind it. sidebar.css hides the
// button and drops every collapsed-state rule there, but CSS cannot reach the
// shortcut: without these guards Mod+B rewrites the site-wide preference while
// nothing on screen moves, and the reader meets the other state on the next
// real page.
describe('a page with no sidebar', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(HAS_SIDEBAR_ATTRIBUTE);
  });

  it('ignores the shortcut and leaves the chord to the browser', () => {
    const event = press(document, { key: 'b', metaKey: true });
    expect(isCollapsed()).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not toggle or write the preference', () => {
    toggleCollapsed();
    expect(isCollapsed()).toBe(false);
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBeNull();
  });

  // The visit must not disturb focus mode either way: mirroring the stored
  // value keeps <html> consistent for the client-side navigation back into the
  // docs, where the same attribute becomes load-bearing again.
  it('still mirrors the stored preference', () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    applyStoredState();
    expect(isCollapsed()).toBe(true);
  });
});

describe('animation marker', () => {
  // sidebar.css keys its collapse transition off this marker so it never
  // animates viewport-driven layout changes (window resize, tablet rotation,
  // a scrollbar appearing) — only an actual toggle.
  it('sets the marker when a toggle drives the collapse', () => {
    toggleCollapsed();
    expect(document.documentElement.hasAttribute(ANIMATING_ATTRIBUTE)).toBe(
      true,
    );
  });

  // applyStoredState runs on load and after every view transition, where the
  // collapsed state must appear instantly with no slide.
  it('does not set the marker when restoring stored state', () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    applyStoredState();
    expect(document.documentElement.hasAttribute(ANIMATING_ATTRIBUTE)).toBe(
      false,
    );
  });

  it('clears the marker via the fallback timeout if transitionend never fires', () => {
    toggleCollapsed();
    expect(document.documentElement.hasAttribute(ANIMATING_ATTRIBUTE)).toBe(
      true,
    );

    vi.advanceTimersByTime(ANIMATION_FALLBACK_MS);
    expect(document.documentElement.hasAttribute(ANIMATING_ATTRIBUTE)).toBe(
      false,
    );
  });

  // Astro's ClientRouter replaces the body, detaching the pane mid-animation.
  // Its transitionend can then never fire, leaving the fallback timeout as the
  // only cleanup path and the module holding a detached node until it runs.
  it('clears the marker when a view transition starts', () => {
    toggleCollapsed();
    expect(document.documentElement.hasAttribute(ANIMATING_ATTRIBUTE)).toBe(
      true,
    );

    document.dispatchEvent(new Event('astro:before-swap'));
    expect(document.documentElement.hasAttribute(ANIMATING_ATTRIBUTE)).toBe(
      false,
    );
  });

  // A missed toggle-then-toggle-again in quick succession must not leave the
  // marker permanently on (blocking future resizes from ever animating) nor
  // clear it early (cutting the second animation's transition short).
  it('does not strand the marker when a second toggle starts before the first settles', () => {
    toggleCollapsed();
    vi.advanceTimersByTime(ANIMATION_FALLBACK_MS - 10);

    toggleCollapsed();
    vi.advanceTimersByTime(20);
    // 20ms after the second toggle, but (FALLBACK - 10 + 20) > FALLBACK ms
    // after the first — if the second toggle failed to reset the pending
    // timer, the first one would already have cleared this.
    expect(document.documentElement.hasAttribute(ANIMATING_ATTRIBUTE)).toBe(
      true,
    );

    vi.advanceTimersByTime(ANIMATION_FALLBACK_MS - 20);
    expect(document.documentElement.hasAttribute(ANIMATING_ATTRIBUTE)).toBe(
      false,
    );
  });
});

// sidebar.css pins --maelstrom-sidebar-width to Starlight's own default,
// because zeroing --sl-sidebar-width leaves the collapsed pane no width to
// slide across. If Starlight changes that default, nothing else in the suite
// notices: the sidebar simply stops travelling its full width and the ToC
// clamp starts from the wrong number. This is the only thing that fails.
describe('pinned sidebar width', () => {
  it('still matches the Starlight default it duplicates', () => {
    const starlightRoot = dirname(
      Bun.resolveSync('@astrojs/starlight/package.json', import.meta.dir),
    );
    const upstream = readFileSync(
      join(starlightRoot, 'style/props.css'),
      'utf8',
    ).match(/--sl-sidebar-width:\s*([^;]+);/)?.[1];

    const ours = readFileSync(
      new URL('../../styles/sidebar.css', import.meta.url),
      'utf8',
    ).match(/--maelstrom-sidebar-width:\s*([^;]+);/)?.[1];

    expect(upstream).toBeDefined();
    expect(ours).toBe(upstream as string);
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
