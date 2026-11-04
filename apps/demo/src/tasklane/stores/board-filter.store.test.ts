import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetBoardFilterStoreForTests,
  boardFilterActions,
  getBoardFilterSnapshot,
} from './board-filter.store';

beforeEach(() => {
  __resetBoardFilterStoreForTests();
});

describe('board assignee filter', () => {
  it('starts showing everyone', () => {
    expect(getBoardFilterSnapshot()).toEqual({ assigneeFilter: null });
  });

  it('filters to one team member by id, name or "me" and reports whether it changed', () => {
    expect(boardFilterActions.filterByAssignee('Alex')).toEqual({
      ok: true,
      changed: true,
      assigneeFilter: 'alex',
    });
    expect(boardFilterActions.filterByAssignee('alex')).toEqual({
      ok: true,
      changed: false,
      assigneeFilter: 'alex',
    });
    expect(boardFilterActions.filterByAssignee('me')).toMatchObject({
      ok: true,
      assigneeFilter: 'chris',
    });
    expect(getBoardFilterSnapshot().assigneeFilter).toBe('chris');
  });

  it('clears the filter for everyone, in any of its words, case and spacing', () => {
    for (const everyone of [
      'everyone',
      'Everyone',
      'all',
      'Anyone',
      ' CLEAR ',
    ]) {
      boardFilterActions.filterByAssignee('sam');
      expect(boardFilterActions.filterByAssignee(everyone), everyone).toEqual({
        ok: true,
        changed: true,
        assigneeFilter: null,
      });
      expect(getBoardFilterSnapshot().assigneeFilter).toBeNull();
    }
  });

  it('refuses an unknown team member and leaves the filter alone', () => {
    boardFilterActions.filterByAssignee('sam');
    expect(boardFilterActions.filterByAssignee('robin')).toEqual({
      ok: false,
      reason: 'unknown_assignee',
      query: 'robin',
    });
    expect(boardFilterActions.filterByAssignee('unassigned')).toEqual({
      ok: false,
      reason: 'unknown_assignee',
      query: 'unassigned',
    });
    expect(getBoardFilterSnapshot().assigneeFilter).toBe('sam');
  });
});
