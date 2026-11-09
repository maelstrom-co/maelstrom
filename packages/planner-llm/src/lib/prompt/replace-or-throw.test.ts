import { describe, expect, test } from 'bun:test';

import { replaceOrThrow } from './replace-or-throw.js';

describe('replaceOrThrow', () => {
  test('replaces the matching text', () => {
    expect(replaceOrThrow('a b c', ' b', '')).toBe('a c');
  });

  test('inserts the replacement literally', () => {
    expect(replaceOrThrow('a', 'a', '$&')).toBe('$&');
  });

  test('throws when the search text is absent', () => {
    expect(() => replaceOrThrow('a b c', 'x', '')).toThrow(
      'text not found in default prompt',
    );
  });
});
