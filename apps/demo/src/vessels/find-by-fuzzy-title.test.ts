import { describe, expect, it } from 'vitest';
import { findByFuzzyTitle } from './find-by-fuzzy-title';

const items = [
  { id: '1', title: 'Gym' },
  { id: '2', title: 'Design review' },
  { id: '3', title: 'Sprint planning' },
];

describe('findByFuzzyTitle', () => {
  it('matches an exact title (case-insensitive)', () => {
    expect(findByFuzzyTitle(items, 'gym')?.id).toBe('1');
  });

  it('matches when the stored title includes the query (forward substring)', () => {
    expect(findByFuzzyTitle(items, 'sign review')?.id).toBe('2');
  });

  it('matches when the query includes the stored title (reverse substring) — LLM composite name against a shorter stored title', () => {
    // The vessel description teaches the LLM the composite
    // "Design review — Studio Vortex HQ", but the store only seeds
    // `title: 'Design review'` with `location` held separately, so the
    // forward-includes check alone can't find it.
    expect(
      findByFuzzyTitle(items, 'Design review — Studio Vortex HQ')?.id,
    ).toBe('2');
  });

  it('picks the most specific (longest title) reverse-substring match rather than the first in list order', () => {
    // Gym is seeded before Design review, so a naive `list.find` would stop
    // at the shorter, less-specific "Gym" match instead of "Design review".
    expect(
      findByFuzzyTitle(items, 'Design review — Gym')?.id,
    ).toBe('2');
  });

  it('breaks a same-length reverse-substring tie by keeping the first match in list order', () => {
    const tied = [
      { id: 'a', title: 'Gym' },
      { id: 'b', title: 'Spa' },
    ];
    expect(findByFuzzyTitle(tied, 'Gym or Spa today')?.id).toBe('a');
  });

  it('returns undefined for a genuinely unrelated query', () => {
    expect(findByFuzzyTitle(items, 'nonexistent event')).toBeUndefined();
  });

  it('returns undefined for a blank query', () => {
    expect(findByFuzzyTitle(items, '   ')).toBeUndefined();
  });
});
