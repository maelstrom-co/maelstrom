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
  'Reviewer feedback on the Maelstrom demo:',
  '',
  '"A great implementation of what I would consider a layout engine."',
  '',
  '"Nice for giving the user the ability to work a UI to meet their personal preferences."',
  '',
  '"Also are the vessels intentional non-human interactable?"',
  '',
  '"For tasks, could I build a widget that connects to other platforms where I manage tasks, like Todoist, ClickUp, or Jira?"',
  '',
  '"I tried to put the weather under the map, and the weather widget, due to its height constraints and text sizes, required half the screen real estate. I couldn\'t change anything about that, even though I wanted it to be very small."',
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
