import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetJournalStoreForTests,
  entryReferenceLabel,
  getJournalSnapshot,
  journalActions,
  resolveEntryReference,
} from './journal.store';

beforeEach(() => {
  __resetJournalStoreForTests();
});

describe('journal ids', () => {
  it('seeds J-1 and J-2 with the original titles', () => {
    expect(
      getJournalSnapshot().entries.map((entry) => [entry.id, entry.title]),
    ).toEqual([
      ['J-1', 'Sprint kickoff'],
      ['J-2', 'Architecture review'],
    ]);
  });

  it('numbers new entries sequentially and restarts after a reset', () => {
    const first = journalActions.createEntry('Design review prep');
    const second = journalActions.createEntry('Retro');
    expect(first.entry.id).toBe('J-3');
    expect(second.entry.id).toBe('J-4');

    __resetJournalStoreForTests();
    expect(journalActions.createEntry('Retro').entry.id).toBe('J-3');
  });

  it('formats references as id and title', () => {
    expect(
      entryReferenceLabel({
        id: 'J-2',
        title: 'Architecture review',
        content: '',
        date: '',
      }),
    ).toBe('J-2 Architecture review');
  });
});

describe('resolveEntryReference', () => {
  it('resolves by id, label and fuzzy title', () => {
    const { entries } = getJournalSnapshot();
    expect(resolveEntryReference(entries, 'J-2')?.title).toBe(
      'Architecture review',
    );
    expect(resolveEntryReference(entries, 'J-1 Sprint kickoff')?.id).toBe(
      'J-1',
    );
    expect(resolveEntryReference(entries, 'architecture')?.id).toBe('J-2');
    expect(resolveEntryReference(entries, 'J-99')).toBeUndefined();
  });
});

describe('resolveEntryReference with id-like titles', () => {
  it('matches a title that starts like an id instead of the id it resembles', () => {
    journalActions.createEntry('J-2 launch notes');
    const { entries } = getJournalSnapshot();
    expect(resolveEntryReference(entries, 'J-2 launch notes')?.id).toBe('J-3');
    expect(resolveEntryReference(entries, 'J-3 J-2 launch notes')?.id).toBe(
      'J-3',
    );
    expect(resolveEntryReference(entries, 'J-2 Architecture review')?.id).toBe(
      'J-2',
    );
  });

  it('finds a title that starts with an unknown id', () => {
    journalActions.createEntry('J-99 retro');
    expect(
      resolveEntryReference(getJournalSnapshot().entries, 'J-99 retro')?.id,
    ).toBe('J-3');
  });
});

describe('journalActions.setEntryContent', () => {
  it('replaces the content instead of appending', () => {
    const result = journalActions.setEntryContent('J-1', 'Fresh text');
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      entry: { id: 'J-1', content: 'Fresh text' },
    });
    expect(
      getJournalSnapshot().entries.find((entry) => entry.id === 'J-1')?.content,
    ).toBe('Fresh text');
  });

  it('reports no change for identical content', () => {
    const current = getJournalSnapshot().entries[0].content;
    const before = getJournalSnapshot();
    expect(journalActions.setEntryContent('J-1', current)).toMatchObject({
      ok: true,
      changed: false,
    });
    expect(getJournalSnapshot()).toBe(before);
  });

  it('reports not_found for an unknown entry', () => {
    expect(journalActions.setEntryContent('Gym log', 'x')).toEqual({
      ok: false,
      reason: 'not_found',
      query: 'Gym log',
    });
  });
});

describe('journalActions.selectEntry', () => {
  it('changes which entry is active without changing any entry data', () => {
    const before = getJournalSnapshot().entries;
    journalActions.selectEntry('J-2');
    expect(getJournalSnapshot().activeEntryId).toBe('J-2');
    expect(getJournalSnapshot().entries).toBe(before);

    journalActions.selectEntry(null);
    expect(getJournalSnapshot().activeEntryId).toBeNull();
    expect(getJournalSnapshot().entries).toBe(before);
  });
});

describe('journal content mutations', () => {
  it('writes to the active entry and reports which entry changed', () => {
    journalActions.createEntry('Design review prep');
    const result = journalActions.writeContent('Prototype checked.');
    expect(result).toMatchObject({
      ok: true,
      entry: { id: 'J-3', content: 'Prototype checked.' },
    });
  });

  it('reports no_active_entry when nothing is open', () => {
    expect(journalActions.writeContent('Lost words')).toEqual({
      ok: false,
      reason: 'no_active_entry',
    });
  });

  it('opens an entry by reference or reports not_found', () => {
    expect(journalActions.openEntry('J-2 Architecture review')).toMatchObject({
      ok: true,
      entry: { id: 'J-2' },
    });
    expect(getJournalSnapshot().activeEntryId).toBe('J-2');
    expect(journalActions.openEntry('Gym log')).toEqual({
      ok: false,
      reason: 'not_found',
      query: 'Gym log',
    });
  });
});
