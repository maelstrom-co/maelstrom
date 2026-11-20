import { describe, expect, test } from 'bun:test';

import {
  capScreenNote,
  describeLateScreenChange,
  SCREEN_NOTE_MAX_CHARS,
} from './screen-note.js';

describe('describeLateScreenChange', () => {
  test('says the outcome settled after the run stopped waiting', () => {
    expect(describeLateScreenChange('applied: "show order o-1"')).toBe(
      'Screen change settled after the run stopped waiting: applied: "show order o-1"',
    );
  });

  test('stays within the screen note limit', () => {
    const note = describeLateScreenChange(`applied: "${'x'.repeat(400)}"`);
    expect(note.length).toBe(SCREEN_NOTE_MAX_CHARS);
    expect(note.endsWith('…')).toBe(true);
  });
});

describe('capScreenNote', () => {
  test('keeps text that fits and cuts longer text with an ellipsis at 300 characters', () => {
    expect(SCREEN_NOTE_MAX_CHARS).toBe(300);
    expect(capScreenNote('short')).toBe('short');
    const capped = capScreenNote('q'.repeat(301));
    expect(capped).toBe(`${'q'.repeat(299)}…`);
  });
});
