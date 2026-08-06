import { describe, expect, test } from 'bun:test';

import { sanitizeControlChars } from './sanitize-control-chars.js';

describe('sanitizeControlChars', () => {
  test('leaves an ordinary string unchanged', () => {
    expect(sanitizeControlChars('Home')).toBe('Home');
  });

  test('replaces an ASCII newline with a space', () => {
    expect(sanitizeControlChars('line one\nline two')).toBe(
      'line one line two',
    );
  });

  test('replaces a control character (DEL, U+007F)', () => {
    expect(sanitizeControlChars(`a${String.fromCharCode(0x7f)}b`)).toBe('a b');
  });

  test('replaces U+0085 (NEL), which JSON.stringify leaves raw', () => {
    const value = `a${String.fromCharCode(0x85)}b`;
    expect(JSON.stringify(value)).toContain(String.fromCharCode(0x85));
    expect(sanitizeControlChars(value)).toBe('a b');
  });

  test('replaces U+2028 (line separator), which JSON.stringify leaves raw', () => {
    const value = `a${String.fromCharCode(0x2028)}b`;
    expect(JSON.stringify(value)).toContain(String.fromCharCode(0x2028));
    expect(sanitizeControlChars(value)).toBe('a b');
  });

  test('replaces U+2029 (paragraph separator), which JSON.stringify leaves raw', () => {
    const value = `a${String.fromCharCode(0x2029)}b`;
    expect(JSON.stringify(value)).toContain(String.fromCharCode(0x2029));
    expect(sanitizeControlChars(value)).toBe('a b');
  });
});
