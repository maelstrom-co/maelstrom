import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetFeedbackStoreForTests,
  FEEDBACK_CHARACTER_LIMIT,
  feedbackActions,
  getFeedbackSnapshot,
} from './feedback.store';

beforeEach(() => {
  __resetFeedbackStoreForTests();
});

describe('feedback snapshot', () => {
  it('seeds labelled sample quotes and one team note within the limit', () => {
    const { text, truncated } = getFeedbackSnapshot();
    expect(truncated).toBe(false);
    expect(text.length).toBeLessThanOrEqual(FEEDBACK_CHARACTER_LIMIT);
    expect(text).toMatch(/^Sample feedback/);
    expect(text).toContain('real layout tool');
    expect(text).toContain('how I work');
    expect(text).toContain('click and edit things');
    expect(text).toContain('tracker my team already uses');
    expect(text).toContain('small one-line version');
    expect(
      text
        .trimEnd()
        .endsWith('Team note: maybe use the pet shop as the example app.'),
    ).toBe(true);
    expect(text.split('\n').length).toBeGreaterThan(5);
  });

  it('replaces the snapshot and reports whether it changed', () => {
    expect(feedbackActions.replaceFeedback('New feedback')).toEqual({
      ok: true,
      changed: true,
      truncated: false,
    });
    expect(getFeedbackSnapshot()).toEqual({
      text: 'New feedback',
      truncated: false,
    });
    expect(feedbackActions.replaceFeedback('New feedback')).toEqual({
      ok: true,
      changed: false,
      truncated: false,
    });
  });

  it('truncates a longer paste to the limit and flags it', () => {
    const long = 'x'.repeat(FEEDBACK_CHARACTER_LIMIT + 50);
    expect(feedbackActions.replaceFeedback(long)).toEqual({
      ok: true,
      changed: true,
      truncated: true,
    });
    const snapshot = getFeedbackSnapshot();
    expect(snapshot.text).toHaveLength(FEEDBACK_CHARACTER_LIMIT);
    expect(snapshot.truncated).toBe(true);
  });

  it('refuses blank feedback and keeps the previous snapshot', () => {
    const before = getFeedbackSnapshot();
    expect(feedbackActions.replaceFeedback('   ')).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(getFeedbackSnapshot()).toBe(before);
  });
});
