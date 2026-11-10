import { beforeEach, describe, expect, it } from 'vitest';

import { feedbackCoverage, isFeedbackQuote } from './feedback-coverage';
import {
  __resetProjectTasksStoreForTests,
  getProjectTasksSnapshot,
  normalizeFeedbackQuote,
  type ProjectTask,
  projectTaskActions,
} from './project-tasks.store';

const QUOTE = '"I like that I can shape the screen around how I work."';

beforeEach(() => {
  __resetProjectTasksStoreForTests();
});

describe('isFeedbackQuote', () => {
  it('accepts paragraphs opening with a straight or curly quote', () => {
    expect(isFeedbackQuote('"Straight."')).toBe(true);
    expect(isFeedbackQuote('“Curly.”')).toBe(true);
    expect(isFeedbackQuote('  “Indented.”')).toBe(true);
  });

  it('rejects notes that do not open with a quote', () => {
    expect(isFeedbackQuote('Team note: “quoted” later.')).toBe(false);
    expect(isFeedbackQuote('')).toBe(false);
  });
});

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
    expect(
      feedbackCoverage(
        QUOTE,
        [],
        [normalizeFeedbackQuote(QUOTE.toUpperCase())],
      ),
    ).toEqual({ kind: 'dropped' });
  });

  it('prefers live tasks over removed ones', () => {
    expect(
      feedbackCoverage(
        QUOTE,
        [task('TL-4', QUOTE)],
        [normalizeFeedbackQuote(QUOTE)],
      ),
    ).toEqual({ kind: 'covered', taskCount: 1 });
  });
});

describe('feedback coverage of tasks created from a quote', () => {
  const LONG_QUOTE = `"${'The weather panel takes up far too much room on a small screen. '.repeat(8).trim()}"`;
  const PIPE_QUOTE = '"Show it as Tasks | Notes | Weather, side by side."';

  it('covers a quote longer than the old stored limit', () => {
    expect(LONG_QUOTE.length).toBeGreaterThan(400);
    projectTaskActions.createTask({
      title: 'Shrink weather',
      source: LONG_QUOTE,
    });
    expect(coverage(LONG_QUOTE)).toEqual({ kind: 'covered', taskCount: 1 });
  });

  it('covers a quote containing a pipe', () => {
    projectTaskActions.createTask({
      title: 'Side by side',
      source: PIPE_QUOTE,
    });
    expect(coverage(PIPE_QUOTE)).toEqual({ kind: 'covered', taskCount: 1 });
  });

  it('says dropped once the task from a long or piped quote is removed', () => {
    projectTaskActions.createTask({
      title: 'Shrink weather',
      source: LONG_QUOTE,
    });
    projectTaskActions.createTask({
      title: 'Side by side',
      source: PIPE_QUOTE,
    });
    projectTaskActions.removeTask('TL-3');
    projectTaskActions.removeTask('TL-4');
    expect(coverage(LONG_QUOTE)).toEqual({ kind: 'dropped' });
    expect(coverage(PIPE_QUOTE)).toEqual({ kind: 'dropped' });
  });
});

function coverage(quote: string) {
  const { tasks, removedSourceFeedback } = getProjectTasksSnapshot();
  return feedbackCoverage(quote, tasks, removedSourceFeedback);
}

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
