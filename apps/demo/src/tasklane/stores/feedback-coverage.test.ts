import { beforeEach, describe, expect, it } from 'vitest';

import {
  feedbackCoverage,
  isFeedbackQuote,
  parseFeedbackQuote,
} from './feedback-coverage';
import {
  __resetProjectTasksStoreForTests,
  feedbackSourceKey,
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

describe('parseFeedbackQuote', () => {
  it('parses an attributed quote with author and date', () => {
    expect(
      parseFeedbackQuote(
        '"I like that I can shape the screen around how I work." - Jonas Lind, 2026-11-03',
      ),
    ).toEqual({
      quote: '"I like that I can shape the screen around how I work."',
      attribution: { author: 'Jonas Lind', date: '2026-11-03' },
    });
  });

  it('supports curly quotes, em dashes and author-only attributions', () => {
    expect(
      parseFeedbackQuote('“This should be editable.” — Maya Chen, 2026-11-02'),
    ).toEqual({
      quote: '“This should be editable.”',
      attribution: { author: 'Maya Chen', date: '2026-11-02' },
    });
    expect(
      parseFeedbackQuote('"Can I edit inside the panels?" - Priya Patel'),
    ).toEqual({
      quote: '"Can I edit inside the panels?"',
      attribution: { author: 'Priya Patel', date: null },
    });
  });

  it('returns null attribution for quotes without a trailing attribution', () => {
    expect(parseFeedbackQuote(QUOTE)).toEqual({
      quote: QUOTE,
      attribution: null,
    });
    expect(
      parseFeedbackQuote('"Call it "Tasklane" - the layout tool"'),
    ).toEqual({
      quote: '"Call it "Tasklane" - the layout tool"',
      attribution: null,
    });
    expect(parseFeedbackQuote('"Quote" - , 2026-11-02')).toEqual({
      quote: '"Quote" - , 2026-11-02',
      attribution: null,
    });
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
      feedbackCoverage(QUOTE, [], [feedbackSourceKey(QUOTE.toUpperCase())]),
    ).toEqual({ kind: 'dropped' });
  });

  it('prefers live tasks over removed ones', () => {
    expect(
      feedbackCoverage(
        QUOTE,
        [task('TL-4', QUOTE)],
        [feedbackSourceKey(QUOTE)],
      ),
    ).toEqual({ kind: 'covered', taskCount: 1 });
  });

  it('matches attributed quotes whether the task source carries the attribution or not', () => {
    const attributed = `${QUOTE} - Jonas Lind, 2026-11-03`;
    const tasks = [
      task('TL-3', QUOTE),
      task('TL-4', attributed),
      task('TL-5', 'i like that i can shape the screen around how i work.'),
    ];
    expect(feedbackCoverage(attributed, tasks, [])).toEqual({
      kind: 'covered',
      taskCount: 3,
    });
    expect(
      feedbackCoverage(attributed, [], [feedbackSourceKey(QUOTE)]),
    ).toEqual({ kind: 'dropped' });
    expect(
      feedbackCoverage(attributed, [], [feedbackSourceKey(attributed)]),
    ).toEqual({ kind: 'dropped' });
    expect(
      feedbackCoverage(
        attributed,
        [],
        [
          feedbackSourceKey(
            '“I like that I can shape the screen around how I work.” — Jonas Lind, 2026-11-03',
          ),
        ],
      ),
    ).toEqual({ kind: 'dropped' });
  });

  it('says dropped for a quote ending in an inner quote mark when the removed source carries a different attribution', () => {
    expect(
      feedbackCoverage(
        '"The status is "Done""',
        [],
        [feedbackSourceKey('"The status is "Done"" - Ana, 2026-11-02')],
      ),
    ).toEqual({ kind: 'dropped' });
    expect(
      feedbackCoverage(
        '"The status is "Done"" - Ana, 2026-11-02',
        [],
        [feedbackSourceKey('"The status is "Done"" - Ana')],
      ),
    ).toEqual({ kind: 'dropped' });
  });

  it('keeps a quote with an inner quote mark apart from a removed source that continues past it', () => {
    expect(
      feedbackCoverage(
        '"Call it "Tasklane""',
        [],
        [feedbackSourceKey('"Call it "Tasklane" - the layout tool"')],
      ),
    ).toEqual({ kind: 'uncovered' });
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

  it('says no task for a different quote that shares the removed source prefix', () => {
    projectTaskActions.createTask({
      title: 'Name it',
      source: '"Call it "Tasklane" - the layout tool"',
    });
    projectTaskActions.removeTask('TL-3');
    expect(coverage('"Call it "Tasklane""')).toEqual({ kind: 'uncovered' });
    expect(coverage('"Call it "Tasklane" - the layout tool"')).toEqual({
      kind: 'dropped',
    });
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
    createdAt: '2026-04-06',
    dueDate: null,
    sourceFeedback,
  };
}
