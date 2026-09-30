import { safeGetItem, safeSetItem } from './preferences';

/**
 * Storage key for the collapsed preference. The pre-paint inline script in
 * Head.astro repeats this literal because it cannot import a module; a unit
 * test asserts the two stay in sync.
 */
export const SIDEBAR_COLLAPSED_KEY = 'maelstrom-sidebar-collapsed';

/** Attribute on <html> that every collapsed-state CSS rule keys off. */
export const COLLAPSED_ATTRIBUTE = 'data-sidebar-collapsed';

/**
 * Starlight's own marker for a page that rendered a sidebar. Set on <html> in
 * its Page.astro; absent on splash pages and on the 404 route.
 */
export const HAS_SIDEBAR_ATTRIBUTE = 'data-has-sidebar';

/**
 * Attribute on <html> that scopes sidebar.css's collapse transition to an
 * actual toggle. .main-pane, .right-sidebar-container and .main-frame derive
 * their size from the viewport, not just from the collapsed state, so an
 * unconditional transition on them animates every window resize too.
 */
export const ANIMATING_ATTRIBUTE = 'data-sidebar-animating';

const READY_ATTRIBUTE = 'data-sidebar-collapse-ready';

/**
 * Longer than sidebar.css's 0.2s transition, so a dropped or cancelled
 * transitionend (e.g. the pane's `display` changes mid-animation) cannot
 * strand the marker on.
 */
export const ANIMATION_FALLBACK_MS = 260;

const TOGGLE_SELECTOR = '[data-sidebar-toggle]';

let initialized = false;
let animationTimeoutId: ReturnType<typeof setTimeout> | undefined;
let animatingPane: Element | null = null;

function onPaneTransitionEnd(event: Event): void {
  // Transitionend bubbles; without this the pane's own nav-link and detail
  // transitions (or a descendant's) would clear the marker early.
  if (event.target !== animatingPane) return;
  clearAnimationMarker();
}

function clearAnimationMarker(): void {
  document.documentElement.removeAttribute(ANIMATING_ATTRIBUTE);
  if (animationTimeoutId !== undefined) {
    clearTimeout(animationTimeoutId);
    animationTimeoutId = undefined;
  }
  animatingPane?.removeEventListener('transitionend', onPaneTransitionEnd);
  animatingPane = null;
}

// Only ever called from the toggle path (never from applyStoredState): load
// and post-view-transition state must appear instantly, with no animation.
function startAnimationMarker(): void {
  clearAnimationMarker(); // rapid repeated toggles must not stack timers
  document.documentElement.setAttribute(ANIMATING_ATTRIBUTE, 'true');
  animatingPane = document.querySelector('.sidebar-pane');
  animatingPane?.addEventListener('transitionend', onPaneTransitionEnd);
  animationTimeoutId = setTimeout(clearAnimationMarker, ANIMATION_FALLBACK_MS);
}

export function isCollapsed(): boolean {
  return document.documentElement.hasAttribute(COLLAPSED_ATTRIBUTE);
}

/**
 * A page with no sidebar has nothing to collapse, and every collapsed-state
 * rule in sidebar.css is gated on this same attribute. Toggling there would
 * write the site-wide preference with nothing on screen changing — the reader
 * would then find the sidebar in the other state on the next real docs page,
 * with no way to connect the two.
 */
function hasSidebar(): boolean {
  return document.documentElement.hasAttribute(HAS_SIDEBAR_ATTRIBUTE);
}

export function setCollapsed(collapsed: boolean, persist = true): void {
  const root = document.documentElement;
  if (collapsed) {
    root.setAttribute(COLLAPSED_ATTRIBUTE, 'true');
  } else {
    root.removeAttribute(COLLAPSED_ATTRIBUTE);
  }
  if (persist) safeSetItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  syncToggles(collapsed);
}

/**
 * Mirror the stored preference onto <html>. Runs on load and after every view
 * transition: Astro's ClientRouter replaces the live <html> attributes with the
 * incoming document's, which would drop focus mode on in-article navigation.
 */
export function applyStoredState(): void {
  setCollapsed(safeGetItem(SIDEBAR_COLLAPSED_KEY) === 'true', false);
}

export function toggleCollapsed(): void {
  if (!hasSidebar()) return;
  const next = !isCollapsed();
  startAnimationMarker();
  setCollapsed(next);
  moveFocusToVisibleToggle(next);
}

function syncToggles(collapsed: boolean): void {
  const expanded = String(!collapsed);
  for (const button of document.querySelectorAll(TOGGLE_SELECTOR)) {
    button.setAttribute('aria-expanded', expanded);
  }
}

/**
 * Activating a toggle hides it, stranding focus on <body>. Hand focus to the
 * button that took its place, but only when a toggle was what had focus — the
 * shortcut must never yank focus out of the article.
 */
function moveFocusToVisibleToggle(collapsed: boolean): void {
  const active = document.activeElement as HTMLElement | null;
  if (!active?.closest(TOGGLE_SELECTOR)) return;
  const variant = collapsed ? 'expand' : 'collapse';
  document
    .querySelector<HTMLElement>(`[data-sidebar-toggle="${variant}"]`)
    ?.focus();
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  // Starlight's search renders into a <dialog>; typing there is not a shortcut.
  return target.closest('dialog') !== null;
}

export function handleShortcut(event: KeyboardEvent): void {
  // Holding the chord auto-repeats; one press is one toggle.
  if (event.repeat) return;
  // Shift is excluded because Cmd/Ctrl+Shift+B is the browser's own
  // bookmarks-bar toggle — claiming it would preventDefault a shortcut the
  // reader already has. Only the bare Mod chord is ours.
  if (event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey))
    return;
  if (event.key.toLowerCase() !== 'b') return;
  if (isTypingTarget(event.target)) return;
  // Checked here as well as in toggleCollapsed: a chord we do not act on must
  // not be swallowed by preventDefault either.
  if (!hasSidebar()) return;
  event.preventDefault();
  toggleCollapsed();
}

function handleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  // Delegated so the listener survives the button being swapped out by a view
  // transition.
  if (target?.closest(TOGGLE_SELECTOR)) toggleCollapsed();
}

export function initSidebarCollapse(): void {
  if (initialized) return;
  initialized = true;
  applyStoredState();
  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleShortcut);
  // The swap detaches the pane, so its transitionend can never fire; without
  // this the module holds a detached node until the fallback timeout runs.
  document.addEventListener('astro:before-swap', clearAnimationMarker);
  document.addEventListener('astro:after-swap', () => {
    applyStoredState();
    document.documentElement.setAttribute(READY_ATTRIBUTE, 'true');
  });
  document.documentElement.setAttribute(READY_ATTRIBUTE, 'true');
}
