import { useSyncExternalStore } from 'react';

export const FEEDBACK_CHARACTER_LIMIT = 2000;

export interface FeedbackState {
  readonly text: string;
  readonly truncated: boolean;
}

export type FeedbackMutationResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly reason: 'empty' };

export const SEED_FEEDBACK = [
  'Sample feedback on the Maelstrom demo, written for this example project:',
  '',
  '"Asking for more room and watching the panels rearrange feels like a real layout tool."',
  '',
  '"I like that I can shape the screen around how I work."',
  '',
  '"Can I also click and edit things inside the panels, or only ask for changes?"',
  '',
  '"Could a task panel sync with the tracker my team already uses?"',
  '',
  '"The weather panel under the map takes up far too much space. I wanted a small one-line version and could not get one."',
  '',
  'Team note: maybe use the pet shop as the example app.',
].join('\n');

const INITIAL_STATE: FeedbackState = { text: SEED_FEEDBACK, truncated: false };

let state: FeedbackState = INITIAL_STATE;

const listeners = new Set<() => void>();

export function useFeedbackStore(): FeedbackState {
  return useSyncExternalStore(
    subscribe,
    getFeedbackSnapshot,
    getFeedbackSnapshot,
  );
}

export function getFeedbackSnapshot(): FeedbackState {
  return state;
}

export function __resetFeedbackStoreForTests(): void {
  setState(INITIAL_STATE);
}

export const feedbackActions = {
  replaceFeedback(text: string): FeedbackMutationResult {
    if (text.trim().length === 0) return { ok: false, reason: 'empty' };
    const truncated = text.length > FEEDBACK_CHARACTER_LIMIT;
    const next: FeedbackState = {
      text: truncated ? text.slice(0, FEEDBACK_CHARACTER_LIMIT) : text,
      truncated,
    };
    const changed =
      next.text !== state.text || next.truncated !== state.truncated;
    if (changed) setState(next);
    return { ok: true, changed, truncated };
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: FeedbackState): void {
  state = next;
  for (const listener of listeners) listener();
}
