import { safeGetItem, safeSetItem } from './preferences';

/**
 * Storage key for the collapsed preference. The pre-paint inline script in
 * Head.astro repeats this literal because it cannot import a module; a unit
 * test asserts the two stay in sync.
 */
export const SIDEBAR_COLLAPSED_KEY = 'maelstrom-sidebar-collapsed';

/** Attribute on <html> that every collapsed-state CSS rule keys off. */
export const COLLAPSED_ATTRIBUTE = 'data-sidebar-collapsed';

const TOGGLE_SELECTOR = '[data-sidebar-toggle]';

let initialized = false;

export function isCollapsed(): boolean {
  return document.documentElement.hasAttribute(COLLAPSED_ATTRIBUTE);
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
  const next = !isCollapsed();
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
  if (event.altKey || !(event.metaKey || event.ctrlKey)) return;
  if (event.key.toLowerCase() !== 'b') return;
  if (isTypingTarget(event.target)) return;
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
  document.addEventListener('astro:after-swap', applyStoredState);
}
