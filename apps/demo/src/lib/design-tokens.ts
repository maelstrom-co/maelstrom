/**
 * Accent color tokens from the shipped `apps/www` brand system
 * (`--color-brand*`, `--color-green`, `--color-amber` in `styles.css`'s
 * `@theme`). MapLibre paint colors and calendar/task chip tints read the
 * hex directly since neither consumer can resolve a CSS custom property.
 */
export type AccentToken = 'brand' | 'brand-2' | 'brand-3' | 'green' | 'amber';

export const ACCENT_HEX: Record<AccentToken, string> = {
  brand: '#0091ff',
  'brand-2': '#00c2ff',
  'brand-3': '#6e5bff',
  green: '#2bd46b',
  amber: '#f5a524',
};

export type VesselName = 'calendar' | 'weather' | 'map' | 'journal' | 'tasks';

export const VESSEL_ACCENTS: Record<VesselName, AccentToken> = {
  calendar: 'brand',
  weather: 'brand-2',
  map: 'brand-3',
  journal: 'green',
  tasks: 'amber',
};

/** Cycles the full shipped palette for calendar event chips — order is fixed, not tied to any per-event identity. */
export const CALENDAR_EVENT_ACCENTS: readonly AccentToken[] = [
  'brand',
  'brand-2',
  'brand-3',
  'green',
  'amber',
];

/**
 * Shared status vocabulary: `ConnectionStatus` (`@maelstrom-co/client`) and
 * `VoiceSessionState` collapse onto one color per state. Consumed by
 * `StatusIndicator` (inline style) and `.voice-orb[data-state]` (CSS) — CSS
 * cannot import this module, so the `[data-state]` rules in `styles.css` are
 * kept in sync with this table by hand.
 */
export type StatusKey =
  | 'idle'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export const STATUS_COLORS: Record<StatusKey, string> = {
  idle: 'var(--color-ink-3)',
  disconnected: 'var(--color-ink-3)',
  connecting: 'var(--color-amber)',
  connected: 'var(--color-brand-2)',
  listening: 'var(--color-brand-2)',
  thinking: 'var(--color-brand-3)',
  speaking: 'var(--color-green)',
  error: 'var(--color-pink)',
};

/** Every accent in `ACCENT_HEX` is a flat `#rrggbb` hex, so an 8-bit alpha suffix is cheaper than parsing to `rgba()`. */
export function accentAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const a = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}
