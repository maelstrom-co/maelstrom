import { useSyncExternalStore } from 'react';

import { findByFuzzyTitle } from './find-by-fuzzy-title';

export interface JournalEntry {
  id: string;
  title: string;
  content: string;
  date: string;
}

interface JournalState {
  entries: JournalEntry[];
  activeEntryId: string | null;
}

export interface EntryNotFound {
  ok: false;
  reason: 'not_found';
  query: string;
}

export type EntryChange =
  | { ok: true; changed: boolean; entry: JournalEntry }
  | EntryNotFound;

export type EntryWrite =
  | { ok: true; entry: JournalEntry }
  | { ok: false; reason: 'no_active_entry' };

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysAgo(n: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return date;
}

const SEED_ENTRIES: JournalEntry[] = [
  {
    id: 'J-1',
    title: 'Sprint kickoff',
    content:
      'Kicked off this sprint — the design review is the big milestone. Team aligned on priorities.',
    date: formatDate(daysAgo(2)),
  },
  {
    id: 'J-2',
    title: 'Architecture review',
    content:
      'Reviewed the module boundaries ahead of the design review. Agreed to split the auth service.',
    date: formatDate(daysAgo(1)),
  },
];

let state: JournalState = {
  entries: SEED_ENTRIES,
  activeEntryId: null,
};
let nextEntryNumber = SEED_ENTRIES.length + 1;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): JournalState {
  return state;
}

function setState(next: JournalState): void {
  state = next;
  for (const l of listeners) l();
}

export function useJournalStore(): JournalState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getJournalSnapshot(): JournalState {
  return state;
}

// Test-only: restores the module-singleton store to its seeded state so
// specs don't leak mutations into one another.
export function __resetJournalStoreForTests(): void {
  nextEntryNumber = SEED_ENTRIES.length + 1;
  setState({
    entries: SEED_ENTRIES.map((e) => ({ ...e })),
    activeEntryId: null,
  });
}

/** The reference published to the Planner and accepted back by every lookup. */
export function entryReferenceLabel(entry: JournalEntry): string {
  return `${entry.id} ${entry.title}`;
}

/**
 * Resolves an id (`J-2`), a published label (`J-2 Architecture review`) or a
 * title. A bare id that names nothing never falls back to a title match.
 */
export function resolveEntryReference(
  entries: readonly JournalEntry[],
  reference: string,
): JournalEntry | undefined {
  const trimmed = reference.trim();
  const id = ENTRY_ID_PATTERN.exec(trimmed)?.[1];
  if (id) {
    const byId = entries.find((entry) => entry.id === id);
    const rest = trimmed.slice(id.length).trim();
    if (!rest) return byId;
    // A title may itself start like an id, so the prefix counts only when
    // the rest names that same entry.
    if (byId && byId.title.toLowerCase() === rest.toLowerCase()) return byId;
  }
  return findByFuzzyTitle([...entries], trimmed);
}

export const journalActions = {
  createEntry(title: string): { ok: true; entry: JournalEntry } {
    const entry: JournalEntry = {
      id: `J-${nextEntryNumber++}`,
      title: title.trim(),
      content: '',
      date: formatDate(new Date()),
    };
    setState({
      entries: [entry, ...state.entries],
      activeEntryId: entry.id,
    });
    return { ok: true, entry };
  },
  openEntry(reference: string): EntryChange {
    const match = resolveEntryReference(state.entries, reference);
    if (!match) return notFound(reference);
    setState({ ...state, activeEntryId: match.id });
    return { ok: true, changed: false, entry: match };
  },
  writeContent(text: string): EntryWrite {
    const active = state.entries.find((e) => e.id === state.activeEntryId);
    if (!active) return { ok: false, reason: 'no_active_entry' };
    const entry = {
      ...active,
      content: active.content ? `${active.content} ${text}` : text,
    };
    replaceEntry(entry);
    return { ok: true, entry };
  },
  setEntryContent(reference: string, content: string): EntryChange {
    const match = resolveEntryReference(state.entries, reference);
    if (!match) return notFound(reference);
    if (match.content === content) {
      return { ok: true, changed: false, entry: match };
    }
    const entry = { ...match, content };
    replaceEntry(entry);
    return { ok: true, changed: true, entry };
  },
  selectEntry(id: string | null): void {
    if (state.activeEntryId === id) return;
    setState({ ...state, activeEntryId: id });
  },
  backToList(): void {
    setState({ ...state, activeEntryId: null });
  },
};

const ENTRY_ID_PATTERN = /^(J-\d+)(?:\s|$)/;

function replaceEntry(entry: JournalEntry): void {
  setState({
    ...state,
    entries: state.entries.map((e) => (e.id === entry.id ? entry : e)),
  });
}

function notFound(query: string): EntryNotFound {
  return { ok: false, reason: 'not_found', query };
}
