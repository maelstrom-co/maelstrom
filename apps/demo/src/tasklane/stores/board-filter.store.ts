import { useSyncExternalStore } from 'react';
import { resolveAssignee, type TeamMemberId } from './team';

/** The value an assignee filter takes to show every team member's tasks again. */
export const EVERYONE = 'everyone';

export interface BoardFilterState {
  /** The team member whose tasks the board shows, or null for everyone. */
  readonly assigneeFilter: TeamMemberId | null;
}

export type BoardFilterResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly assigneeFilter: TeamMemberId | null;
    }
  | {
      readonly ok: false;
      readonly reason: 'unknown_assignee';
      readonly query: string;
    };

const INITIAL_STATE: BoardFilterState = { assigneeFilter: null };
const EVERYONE_WORDS = new Set([EVERYONE, 'all', 'anyone', 'clear']);

let state: BoardFilterState = INITIAL_STATE;

const listeners = new Set<() => void>();

export function useBoardFilterStore(): BoardFilterState {
  return useSyncExternalStore(
    subscribe,
    getBoardFilterSnapshot,
    getBoardFilterSnapshot,
  );
}

export function getBoardFilterSnapshot(): BoardFilterState {
  return state;
}

export function __resetBoardFilterStoreForTests(): void {
  setState(INITIAL_STATE);
}

export const boardFilterActions = {
  /**
   * Shows only one team member's tasks, by team id, name or "me", or
   * everyone's again for `everyone`. Unassigned is not a filter.
   */
  filterByAssignee(assignee: string): BoardFilterResult {
    if (EVERYONE_WORDS.has(assignee.trim().toLowerCase())) return apply(null);
    const resolved = resolveAssignee(assignee);
    if (!resolved)
      return { ok: false, reason: 'unknown_assignee', query: assignee };
    return apply(resolved);
  },

  clearAssigneeFilter(): BoardFilterResult {
    return apply(null);
  },
};

function apply(assigneeFilter: TeamMemberId | null): BoardFilterResult {
  const changed = assigneeFilter !== state.assigneeFilter;
  if (changed) setState({ assigneeFilter });
  return { ok: true, changed, assigneeFilter };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: BoardFilterState): void {
  state = next;
  for (const listener of listeners) listener();
}
