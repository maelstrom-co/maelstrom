import { feedbackSourceKey, type ProjectTask } from './project-tasks.store';

export {
  type FeedbackAttribution,
  isFeedbackQuote,
  type ParsedFeedbackQuote,
  parseFeedbackQuote,
} from './feedback-quote';

export type FeedbackCoverage =
  | { readonly kind: 'covered'; readonly taskCount: number }
  | { readonly kind: 'uncovered' }
  | { readonly kind: 'dropped' };

/**
 * Whether tasks come from a feedback quote: covered by live tasks, dropped
 * when only removed tasks came from it, or uncovered when none ever did.
 * `removedSources` holds `feedbackSourceKey` keys.
 */
export function feedbackCoverage(
  quote: string,
  tasks: readonly ProjectTask[],
  removedSources: readonly string[],
): FeedbackCoverage {
  const wanted = feedbackSourceKey(quote);
  const taskCount = tasks.filter(
    (task) =>
      task.sourceFeedback !== null &&
      feedbackSourceKey(task.sourceFeedback) === wanted,
  ).length;
  if (taskCount > 0) return { kind: 'covered', taskCount };
  return removedSources.includes(wanted)
    ? { kind: 'dropped' }
    : { kind: 'uncovered' };
}
