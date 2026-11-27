import { describe, expect, it } from 'bun:test';

import {
  createReferenceResolver,
  DEFAULT_MAX_REFERENCE_CHOICES,
} from './reference-resolver.js';

interface SampleItem {
  readonly id: string;
  readonly title: string;
  readonly tag?: string;
}

const ITEMS: readonly SampleItem[] = [
  { id: 'TL-1', title: 'Update demo README', tag: 'docs' },
  { id: 'TL-2', title: 'Record launch video', tag: 'media' },
  { id: 'TL-3', title: 'Blue Nylon Collar', tag: 'gear' },
];

describe('createReferenceResolver', () => {
  describe('matching ladder', () => {
    const resolver = createReferenceResolver({
      items: ITEMS,
      id: (item) => item.id,
      title: (item) => item.title,
      label: (item) => `${item.id} ${item.title} (${item.tag ?? 'general'})`,
    });

    it('rung 1: matches an exact id case-insensitively with trimming', () => {
      expect(resolver.resolve('  tl-2  ')).toEqual({
        kind: 'found',
        item: ITEMS[1],
      });
    });

    it('prefers an exact-case id over ids that differ only by case', () => {
      const caseItems: readonly SampleItem[] = [
        { id: 'Ab1', title: 'Upper' },
        { id: 'ab1', title: 'Lower' },
      ];
      const caseResolver = createReferenceResolver({
        items: caseItems,
        id: (item) => item.id,
        title: (item) => item.title,
      });

      expect(caseResolver.resolve('Ab1')).toEqual({
        kind: 'found',
        item: caseItems[0],
      });
      expect(caseResolver.resolve('ab1')).toEqual({
        kind: 'found',
        item: caseItems[1],
      });
      expect(caseResolver.resolve('AB1').kind).toBe('ambiguous');
    });

    it('rung 2: matches an exact published label case-insensitively', () => {
      expect(resolver.resolve('tl-1 update demo readme (docs)')).toEqual({
        kind: 'found',
        item: ITEMS[0],
      });
    });

    it('rung 3: matches an exact normalized title ignoring punctuation and case', () => {
      expect(resolver.resolve('  "Update DEMO README!"  ')).toEqual({
        kind: 'found',
        item: ITEMS[0],
      });
    });

    it('prefers an exact title over a forward substring match', () => {
      const exactAndPrefix = createReferenceResolver({
        items: [
          { id: '1', title: 'Demo' },
          { id: '2', title: 'Demo polish' },
        ],
        id: (item) => item.id,
        title: (item) => item.title,
      });
      expect(exactAndPrefix.resolve('demo')).toEqual({
        kind: 'found',
        item: { id: '1', title: 'Demo' },
      });
    });

    it('rung 4: matches a forward substring of the normalized title', () => {
      expect(resolver.resolve('launch video')).toEqual({
        kind: 'found',
        item: ITEMS[1],
      });
    });

    it('rung 5: matches a reverse substring and picks the most specific (longest) title', () => {
      const events = createReferenceResolver({
        items: [
          { id: '1', title: 'Gym' },
          { id: '2', title: 'Design review' },
          { id: '3', title: 'Sprint planning' },
        ],
        id: (item) => item.id,
        title: (item) => item.title,
      });

      expect(events.resolve('Design review — Studio Vortex HQ')).toEqual({
        kind: 'found',
        item: { id: '2', title: 'Design review' },
      });
      expect(events.resolve('Design review — Gym')).toEqual({
        kind: 'found',
        item: { id: '2', title: 'Design review' },
      });
    });

    it('rung 6: matches when all query words appear in the title in any order or with gaps', () => {
      expect(resolver.resolve('blue collar')).toEqual({
        kind: 'found',
        item: ITEMS[2],
      });
      expect(resolver.resolve('readme update')).toEqual({
        kind: 'found',
        item: ITEMS[0],
      });
    });

    it('does not confuse a title starting like another id with that id', () => {
      const withIdLikeTitle = createReferenceResolver({
        items: [
          { id: 'T-2', title: 'Prep design review notes' },
          { id: 'T-4', title: 'T-2 retro follow-up' },
        ],
        id: (item) => item.id,
        title: (item) => item.title,
      });

      expect(withIdLikeTitle.resolve('T-2 retro follow-up')).toEqual({
        kind: 'found',
        item: { id: 'T-4', title: 'T-2 retro follow-up' },
      });
      expect(withIdLikeTitle.resolve('T-2')).toEqual({
        kind: 'found',
        item: { id: 'T-2', title: 'Prep design review notes' },
      });
    });
  });

  describe('reader function', () => {
    it('reads fresh items on every resolve call when given a function', () => {
      const live: SampleItem[] = [{ id: 'TL-1', title: 'First task' }];
      const resolver = createReferenceResolver({
        items: () => live,
        id: (item) => item.id,
        title: (item) => item.title,
      });

      expect(resolver.resolve('TL-2').kind).toBe('not_found');

      live.push({ id: 'TL-2', title: 'Second task' });
      expect(resolver.resolve('TL-2')).toEqual({
        kind: 'found',
        item: { id: 'TL-2', title: 'Second task' },
      });
    });
  });

  describe('ambiguity', () => {
    it('returns ambiguous with candidates and message when multiple items match', () => {
      const resolver = createReferenceResolver({
        items: [
          { id: 'TL-3', title: 'Demo copy for home' },
          { id: 'TL-4', title: 'Demo copy for docs' },
        ],
        id: (item) => item.id,
        title: (item) => item.title,
      });

      const result = resolver.resolve('demo copy');
      expect(result).toEqual({
        kind: 'ambiguous',
        query: 'demo copy',
        candidates: [
          { id: 'TL-3', title: 'Demo copy for home' },
          { id: 'TL-4', title: 'Demo copy for docs' },
        ],
        message:
          '"demo copy" matches multiple choices: TL-3 Demo copy for home, TL-4 Demo copy for docs.',
      });
    });

    it('returns ambiguous on a same-length reverse-substring tie', () => {
      const resolver = createReferenceResolver({
        items: [
          { id: 'a', title: 'Gym' },
          { id: 'b', title: 'Spa' },
        ],
        id: (item) => item.id,
        title: (item) => item.title,
        label: (item) => item.title,
      });

      const result = resolver.resolve('Gym or Spa today');
      expect(result.kind).toBe('ambiguous');
      if (result.kind !== 'ambiguous') throw new Error('expected ambiguous');
      expect(result.candidates.map((item) => item.id)).toEqual(['a', 'b']);
      expect(result.message).toBe(
        '"Gym or Spa today" matches multiple choices: Gym, Spa.',
      );
    });
  });

  describe('not_found and bounded choice list', () => {
    it('returns not_found with valid choices for an unknown id, blank query, or punctuation-only title', () => {
      const resolver = createReferenceResolver({
        items: [
          { id: 'TL-1', title: 'Update demo README' },
          { id: 'TL-2', title: '!!!' },
        ],
        id: (item) => item.id,
        title: (item) => item.title,
      });

      const unknown = resolver.resolve('TL-99');
      expect(unknown).toEqual({
        kind: 'not_found',
        query: 'TL-99',
        message:
          'No match for "TL-99". Valid choices: TL-1 Update demo README, TL-2 !!!.',
      });

      expect(resolver.resolve('   ').kind).toBe('not_found');
      expect(resolver.resolve('!!!').kind).toBe('not_found');
      expect(resolver.resolve('Ghost').kind).toBe('not_found');
    });

    it('reports when no valid choices exist', () => {
      const resolver = createReferenceResolver({
        items: [] as SampleItem[],
        id: (item) => item.id,
        title: (item) => item.title,
      });

      expect(resolver.resolve('TL-1')).toEqual({
        kind: 'not_found',
        query: 'TL-1',
        message: 'No match for "TL-1". No valid choices are available.',
      });
    });

    it('bounds the listed choices to maxChoices and summarizes the remainder', () => {
      const many = Array.from({ length: 25 }, (_, index) => ({
        id: `TL-${index + 1}`,
        title: `Task ${index + 1}`,
      }));

      const defaultBounded = createReferenceResolver({
        items: many,
        id: (item) => item.id,
        title: (item) => item.title,
      });
      const defaultMiss = defaultBounded.resolve('TL-999');
      expect(defaultMiss.kind).toBe('not_found');
      if (defaultMiss.kind !== 'not_found')
        throw new Error('expected not_found');
      expect(defaultMiss.message).toContain(
        `TL-${DEFAULT_MAX_REFERENCE_CHOICES} Task ${DEFAULT_MAX_REFERENCE_CHOICES} and ${many.length - DEFAULT_MAX_REFERENCE_CHOICES} more.`,
      );
      expect(defaultMiss.message).not.toContain(
        `TL-${DEFAULT_MAX_REFERENCE_CHOICES + 1} `,
      );

      const customBounded = createReferenceResolver({
        items: many,
        id: (item) => item.id,
        title: (item) => item.title,
        maxChoices: 3,
      });
      const customMiss = customBounded.resolve('TL-999');
      expect(customMiss).toEqual({
        kind: 'not_found',
        query: 'TL-999',
        message:
          'No match for "TL-999". Valid choices: TL-1 Task 1, TL-2 Task 2, TL-3 Task 3 and 22 more.',
      });

      const ambiguousBounded = customBounded.resolve('Task');
      expect(ambiguousBounded.kind).toBe('ambiguous');
      if (ambiguousBounded.kind !== 'ambiguous')
        throw new Error('expected ambiguous');
      expect(ambiguousBounded.candidates).toHaveLength(25);
      expect(ambiguousBounded.message).toBe(
        '"Task" matches multiple choices: TL-1 Task 1, TL-2 Task 2, TL-3 Task 3 and 22 more.',
      );
    });
  });
});
