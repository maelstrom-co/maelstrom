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

const SEED_ENTRIES: JournalEntry[] = [
  {
    id: '1',
    title: 'Project kickoff',
    content:
      'Discussed roadmap and milestones for Q2. Team aligned on priorities.',
    date: 'Apr 3, 2026',
  },
  {
    id: '2',
    title: 'Architecture review',
    content:
      'Reviewed the new module boundaries. Agreed to split the auth service.',
    date: 'Apr 4, 2026',
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

function formatToday(): string {
  return new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function useJournalStore(): JournalState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getJournalSnapshot(): JournalState {
  return state;
}

export const journalActions = {
  createEntry(title: string): void {
    const entry: JournalEntry = {
      id: crypto.randomUUID(),
      title,
      content: '',
      date: formatToday(),
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
