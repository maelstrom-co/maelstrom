import { describe, expect, it } from 'vitest';
import {
  ACCENT_HEX,
  CALENDAR_EVENT_ACCENTS,
  STATUS_COLORS,
  VESSEL_ACCENTS,
  accentAlpha,
  type StatusKey,
} from './design-tokens';

const ALL_VESSELS = ['calendar', 'weather', 'map', 'journal', 'tasks'] as const;

const ALL_STATUS_KEYS: StatusKey[] = [
  'idle',
  'disconnected',
  'connecting',
  'connected',
  'listening',
  'thinking',
  'speaking',
  'error',
];

describe('ACCENT_HEX', () => {
  it('matches the spec palette exactly', () => {
    expect(ACCENT_HEX.brand).toBe('#0091ff');
    expect(ACCENT_HEX['brand-2']).toBe('#00c2ff');
    expect(ACCENT_HEX['brand-3']).toBe('#6e5bff');
    expect(ACCENT_HEX.green).toBe('#2bd46b');
    expect(ACCENT_HEX.amber).toBe('#f5a524');
  });
});

describe('VESSEL_ACCENTS', () => {
  it('assigns every vessel an accent token that resolves to a real hex', () => {
    for (const vessel of ALL_VESSELS) {
      const token = VESSEL_ACCENTS[vessel];
      expect(ACCENT_HEX[token]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('matches the spec §3 accent table', () => {
    expect(VESSEL_ACCENTS.calendar).toBe('brand');
    expect(VESSEL_ACCENTS.weather).toBe('brand-2');
    expect(VESSEL_ACCENTS.map).toBe('brand-3');
    expect(VESSEL_ACCENTS.journal).toBe('green');
    expect(VESSEL_ACCENTS.tasks).toBe('amber');
  });
});

describe('CALENDAR_EVENT_ACCENTS', () => {
  it('cycles every accent token in the shipped palette exactly once', () => {
    expect(CALENDAR_EVENT_ACCENTS).toHaveLength(5);
    expect(new Set(CALENDAR_EVENT_ACCENTS).size).toBe(5);
    for (const token of CALENDAR_EVENT_ACCENTS) {
      expect(ACCENT_HEX[token]).toBeDefined();
    }
  });
});

describe('STATUS_COLORS', () => {
  it('has an entry for every ConnectionStatus + VoiceSessionState value', () => {
    for (const key of ALL_STATUS_KEYS) {
      expect(STATUS_COLORS[key]).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
    }
  });

  it('matches the spec §6 status vocabulary table', () => {
    expect(STATUS_COLORS.idle).toBe('var(--color-ink-3)');
    expect(STATUS_COLORS.disconnected).toBe('var(--color-ink-3)');
    expect(STATUS_COLORS.connecting).toBe('var(--color-amber)');
    expect(STATUS_COLORS.connected).toBe('var(--color-brand-2)');
    expect(STATUS_COLORS.listening).toBe('var(--color-brand-2)');
    expect(STATUS_COLORS.thinking).toBe('var(--color-brand-3)');
    expect(STATUS_COLORS.speaking).toBe('var(--color-green)');
    expect(STATUS_COLORS.error).toBe('var(--color-pink)');
  });
});

describe('accentAlpha', () => {
  it('appends a rounded 8-bit alpha suffix to a flat hex', () => {
    expect(accentAlpha('#0091ff', 1)).toBe('#0091ffff');
    expect(accentAlpha('#0091ff', 0)).toBe('#0091ff00');
    expect(accentAlpha('#f5a524', 0.35)).toBe('#f5a52459');
    expect(accentAlpha('#f5a524', 0.22)).toBe('#f5a52438');
  });

  it('clamps out-of-range alpha', () => {
    expect(accentAlpha('#0091ff', 2)).toBe('#0091ffff');
    expect(accentAlpha('#0091ff', -1)).toBe('#0091ff00');
  });
});
