import {
  normalizeFeedbackQuote,
  type ProjectTask,
} from './project-tasks.store';

export type FeedbackCoverage =
  | { readonly kind: 'covered'; readonly taskCount: number }
  | { readonly kind: 'uncovered' }
  | { readonly kind: 'dropped' };

/** Whether a feedback paragraph opens with a straight or curly quote mark. */
export function isFeedbackQuote(paragraph: string): boolean {
  return OPENING_QUOTE_MARK.test(paragraph);
}

/**
 * Whether tasks come from a feedback quote: covered by live tasks, dropped
 * when only removed tasks came from it, or uncovered when none ever did.
 * `removedSources` holds `normalizeFeedbackQuote` keys.
 */
export function feedbackCoverage(
  quote: string,
  tasks: readonly ProjectTask[],
  removedSources: readonly string[],
): FeedbackCoverage {
  const wanted = normalizeFeedbackQuote(quote);
  const taskCount = tasks.filter(
    (task) =>
      task.sourceFeedback !== null &&
      normalizeFeedbackQuote(task.sourceFeedback) === wanted,
  ).length;
  if (taskCount > 0) return { kind: 'covered', taskCount };
  return removedSources.includes(wanted)
    ? { kind: 'dropped' }
    : { kind: 'uncovered' };
}

const OPENING_QUOTE_MARK = /^\s*["“]/;
