import { describe, expect, test } from 'bun:test';

import { sanitizeLineBreakChars } from './sanitize-line-break-chars.js';

describe('sanitizeLineBreakChars', () => {
  test('leaves an ordinary string unchanged', () => {
    expect(sanitizeLineBreakChars('Home')).toBe('Home');
  });

  test('replaces an ASCII newline with a space', () => {
    expect(sanitizeLineBreakChars('line one\nline two')).toBe(
      'line one line two',
    );
  });

  test('replaces a control character (DEL, U+007F)', () => {
    expect(sanitizeLineBreakChars(`a${String.fromCharCode(0x7f)}b`)).toBe(
      'a b',
    );
  });

  test('replaces U+0085 (NEL), which JSON.stringify leaves raw', () => {
    const value = `a${String.fromCharCode(0x85)}b`;
    expect(JSON.stringify(value)).toContain(String.fromCharCode(0x85));
    expect(sanitizeLineBreakChars(value)).toBe('a b');
  });

  test('replaces U+2028 (line separator), which JSON.stringify leaves raw', () => {
    const value = `a${String.fromCharCode(0x2028)}b`;
    expect(JSON.stringify(value)).toContain(String.fromCharCode(0x2028));
    expect(sanitizeLineBreakChars(value)).toBe('a b');
  });

  test('replaces U+2029 (paragraph separator), which JSON.stringify leaves raw', () => {
    const value = `a${String.fromCharCode(0x2029)}b`;
    expect(JSON.stringify(value)).toContain(String.fromCharCode(0x2029));
    expect(sanitizeLineBreakChars(value)).toBe('a b');
  });
});
