import { describe, expect, it } from 'vitest';
import { feedbackCoverage, normalizeFeedbackQuote } from './feedback-coverage';
import type { ProjectTask } from './project-tasks.store';

const QUOTE = '"I like that I can shape the screen around how I work."';

describe('normalizeFeedbackQuote', () => {
  it('ignores surrounding quote marks, spacing and case', () => {
    const expected = 'i like that i can shape the screen around how i work.';
    expect(normalizeFeedbackQuote(QUOTE)).toBe(expected);
    expect(
      normalizeFeedbackQuote(
        '  “I like that I can   shape the screen\naround how I work.”  ',
      ),
    ).toBe(expected);
    expect(
      normalizeFeedbackQuote(
        'i like that i can shape the screen around how i work.',
      ),
    ).toBe(expected);
  });

  it('keeps quote marks inside the text', () => {
    expect(normalizeFeedbackQuote('"Call it "Tasklane" please"')).toBe(
      'call it "tasklane" please',
    );
  });
});

describe('feedbackCoverage', () => {
  it('counts the live tasks whose source matches the quote', () => {
    const tasks = [
      task('TL-3', 'i like that I can shape the screen around how I work.'),
      task('TL-4', QUOTE),
      task('TL-5', 'Something else'),
      task('TL-6', null),
    ];
    expect(feedbackCoverage(QUOTE, tasks, [])).toEqual({
      kind: 'covered',
      taskCount: 2,
    });
  });

  it('says no task when no task ever came from the quote', () => {
    expect(feedbackCoverage(QUOTE, [task('TL-3', 'Other')], ['Other'])).toEqual(
      { kind: 'uncovered' },
    );
  });

  it('says dropped when every task from the quote was removed', () => {
    expect(feedbackCoverage(QUOTE, [], [QUOTE.toUpperCase()])).toEqual({
      kind: 'dropped',
    });
  });

  it('prefers live tasks over removed ones', () => {
    expect(feedbackCoverage(QUOTE, [task('TL-4', QUOTE)], [QUOTE])).toEqual({
      kind: 'covered',
      taskCount: 1,
    });
  });
});

function task(id: string, sourceFeedback: string | null): ProjectTask {
  return {
    id,
    title: id,
    description: '',
    parentId: null,
    assigneeId: null,
    urgency: 'normal',
    status: 'todo',
    sourceFeedback,
  };
}
