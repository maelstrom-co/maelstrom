import type { ProjectTask } from './project-tasks.store';

export type FeedbackCoverage =
  | { readonly kind: 'covered'; readonly taskCount: number }
  | { readonly kind: 'uncovered' }
  | { readonly kind: 'dropped' };

const SURROUNDING_QUOTE_MARKS = /^["'“”‘’]+|["'“”‘’]+$/g;

/**
 * The form two quotes are compared in: trimmed, without surrounding quote
 * marks, with whitespace collapsed and lower case. The Planner may copy a
 * quote with or without its quote marks.
 */
export function normalizeFeedbackQuote(text: string): string {
  return text
    .trim()
    .replace(SURROUNDING_QUOTE_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Whether tasks come from a feedback quote: covered by live tasks, dropped
 * when only removed tasks came from it, or uncovered when none ever did.
 */
export function feedbackCoverage(
  quote: string,
  tasks: readonly ProjectTask[],
  removedSources: readonly string[],
): FeedbackCoverage {
  const wanted = normalizeFeedbackQuote(quote);
  const matches = (source: string | null) =>
    source !== null && normalizeFeedbackQuote(source) === wanted;
  const taskCount = tasks.filter((task) => matches(task.sourceFeedback)).length;
  if (taskCount > 0) return { kind: 'covered', taskCount };
  return removedSources.some(matches)
    ? { kind: 'dropped' }
    : { kind: 'uncovered' };
}
