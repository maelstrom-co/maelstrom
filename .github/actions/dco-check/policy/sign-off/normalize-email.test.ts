import { describe, expect, it } from 'bun:test';
import { normalizeEmail } from './normalize-email.ts';

describe('normalizeEmail', () => {
  it('case-folds the address', () => {
    expect(normalizeEmail('ADA@Example.COM')).toBe('ada@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  ada@example.com\t')).toBe('ada@example.com');
  });

  it('trims a trailing carriage return', () => {
    expect(normalizeEmail('ada@example.com\r')).toBe('ada@example.com');
  });

  it('reduces a whitespace-only address to the empty string', () => {
    expect(normalizeEmail(' ')).toBe('');
  });

  it('does not strip a + alias', () => {
    // The attestation should be literal: `+`-alias folding would let one
    // identity certify a commit authored under another.
    expect(normalizeEmail('ada+dco@example.com')).toBe('ada+dco@example.com');
  });

  it('does not fold Gmail dots', () => {
    expect(normalizeEmail('a.d.a@gmail.com')).toBe('a.d.a@gmail.com');
  });

  it('leaves an already-normalized address alone', () => {
    expect(normalizeEmail('ada@example.com')).toBe('ada@example.com');
  });
});
