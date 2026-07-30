import { nanoid } from 'nanoid';
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
    id: '1',
    title: 'Sprint kickoff',
    content:
      'Kicked off this sprint — the design review is the big milestone. Team aligned on priorities.',
    date: formatDate(daysAgo(2)),
  },
  {
    id: '2',
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
export function resetJournalStore(): void {
  setState({
    entries: SEED_ENTRIES.map((e) => ({ ...e })),
    activeEntryId: null,
  });
}

export const journalActions = {
  createEntry(title: string): void {
    const entry: JournalEntry = {
      id: nanoid(),
      title,
      content: '',
      date: formatDate(new Date()),
    };
    setState({
      entries: [entry, ...state.entries],
      activeEntryId: entry.id,
    });
  },
  openEntry(title: string): JournalEntry | null {
    const match = findByFuzzyTitle(state.entries, title);
    if (!match) return null;
    setState({ ...state, activeEntryId: match.id });
    return match;
  },
  writeContent(text: string): boolean {
    if (!state.activeEntryId) return false;
    setState({
      ...state,
      entries: state.entries.map((e) =>
        e.id === state.activeEntryId
          ? { ...e, content: e.content ? `${e.content} ${text}` : text }
          : e,
      ),
    });
    return true;
  },
  backToList(): void {
    setState({ ...state, activeEntryId: null });
  },
};
