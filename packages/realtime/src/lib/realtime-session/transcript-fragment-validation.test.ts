import { describe, expect, it } from 'bun:test';
import type { TimedTranscriptFragment } from '@maelstrom-co/client';
import {
  DEFAULT_MAX_FRAGMENT_CHARS,
  isValidFragment,
} from './transcript-fragment-validation.js';

describe('isValidFragment', () => {
  it('accepts a well-formed fragment, including an empty text and a zero-length span', () => {
    expect(isValidFragment(valid)).toBe(true);
    expect(isValidFragment({ ...valid, text: '', endMs: valid.startMs })).toBe(
      true,
    );
  });

  it('rejects missing or oversized identities', () => {
    for (const id of ['', 'x'.repeat(257)])
      expect(isValidFragment({ ...valid, id })).toBe(false);
    for (const speakerId of ['', 'x'.repeat(257)])
      expect(isValidFragment({ ...valid, speakerId })).toBe(false);
    expect(isValidFragment({ ...valid, id: 'x'.repeat(256) })).toBe(true);
  });

  it('rejects timing that is not finite, negative, or reversed', () => {
    for (const timing of [
      { startMs: Number.NaN },
      { endMs: Number.POSITIVE_INFINITY },
      { startMs: -1 },
      { startMs: 50, endMs: 10 },
    ])
      expect(isValidFragment({ ...valid, ...timing })).toBe(false);
  });

  it('bounds text by the given limit, defaulting to the store default', () => {
    expect(isValidFragment({ ...valid, text: 'abcd' }, 3)).toBe(false);
    expect(isValidFragment({ ...valid, text: 'abc' }, 3)).toBe(true);
    const longest = 'x'.repeat(DEFAULT_MAX_FRAGMENT_CHARS);
    expect(isValidFragment({ ...valid, text: longest })).toBe(true);
    expect(isValidFragment({ ...valid, text: `${longest}x` })).toBe(false);
  });
});

const valid: TimedTranscriptFragment = {
  id: 'fragment-1',
  role: 'user',
  speakerId: 'user',
  text: 'hello',
  startMs: 0,
  endMs: 100,
};
