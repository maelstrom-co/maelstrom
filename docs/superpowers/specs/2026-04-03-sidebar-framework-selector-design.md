# Sidebar Framework Selector Extraction — Design Spec

**Goal:** Extract Sidebar.astro's 165-line inline script into two focused modules (`preferences.ts`, `framework-selector.ts`) with tests, creating a shared preference utility reusable by Pagination.astro.

## Architecture

Two modules under `apps/docs/src/lib/`:

1. **`preferences.ts`** — Shared localStorage wrapper with safe error handling. Used by both FrameworkSelector (Sidebar) and PageFeedback (Pagination, future).
2. **`framework-selector.ts`** — Self-registering custom element (`<framework-selector>`). Contains the `FrameworkSelector` class, label/ID lookup maps, `syncStarlightTabs`, and `customElements.define`. Imports from `preferences.ts`.

Sidebar.astro's `<script>` becomes a single import: `import '../lib/framework-selector';`

## Module Interfaces

### `preferences.ts`

```ts
/** Read from localStorage, returning null if storage is unavailable. */
export function safeGetItem(key: string): string | null;

/** Write to localStorage, silently failing if storage is unavailable. */
export function safeSetItem(key: string, value: string): void;
```

### `framework-selector.ts`

No public API — the module self-registers the `<framework-selector>` custom element as a side effect of import. All logic is internal to the `FrameworkSelector` class.

Internal structure:
- `FRAMEWORK_LABELS: Record<string, string>` — `{ react: 'React', vanilla: 'Vanilla JS', solid: 'Solid' }`
- `LABEL_TO_FRAMEWORK: Record<string, string>` — reverse mapping
- `syncStarlightTabs(label: string): void` — switches visible Starlight `<Tabs syncKey="framework">` without stealing focus
- `class FrameworkSelector extends HTMLElement` — the custom element with:
  - `connectedCallback()` — event wiring, preference loading, keyboard nav
  - `disconnectedCallback()` — AbortController cleanup
  - `#selectFramework(fw: string)` — UI update (label, icon, aria-selected)

## What Changes

| File | Change |
|------|--------|
| `src/lib/preferences.ts` | **Create** — ~10 LOC |
| `src/lib/framework-selector.ts` | **Create** — ~155 LOC |
| `src/lib/__tests__/preferences.test.ts` | **Create** |
| `src/lib/__tests__/framework-selector.test.ts` | **Create** |
| `src/components/Sidebar.astro` | **Modify** — replace 165-line `<script>` with 1-line import |

## Testing Strategy

### `preferences.test.ts` (pure, no DOM needed)
- `safeGetItem` returns value when localStorage works
- `safeGetItem` returns null when localStorage throws
- `safeSetItem` writes value when localStorage works
- `safeSetItem` does not throw when localStorage throws

### `framework-selector.test.ts` (jsdom)
- **syncStarlightTabs:** switches tab visibility by label, handles missing tabs gracefully
- **FrameworkSelector connected:** loads saved preference from localStorage, syncs to Starlight tabs key
- **FrameworkSelector pick:** updates UI, persists to localStorage, syncs Starlight tabs
- **Keyboard navigation:** ArrowDown/Up cycles options, Home/End jump to first/last, Enter selects, Escape closes
- **Idempotency:** double connectedCallback doesn't create duplicate listeners
- **Reverse bridge:** clicking a Starlight tab updates the sidebar dropdown

Note: `syncStarlightTabs` is exported solely for testing — it's an internal implementation detail of the framework selector module.

## Constraints

- The custom element must self-register via `customElements.define('framework-selector', FrameworkSelector)` at module scope — Sidebar.astro's template already renders `<framework-selector>` tags.
- The `AbortController` cleanup pattern in `disconnectedCallback` must be preserved for view transition compatibility.
- `syncStarlightTabs` must NOT steal focus when switching tabs (current behavior, important for a11y).
- `preferences.ts` must use try-catch around all localStorage access (Safari private browsing throws).
