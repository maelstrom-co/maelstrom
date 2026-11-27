import { parseFeedbackQuote } from './feedback-quote';
import {
  feedbackSourceKey,
  normalizeFeedbackQuote,
  type ProjectTask,
} from './project-tasks.store';

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
  const matches = sourceMatcher(quote);
  const taskCount = tasks.filter(
    (task) =>
      task.sourceFeedback !== null &&
      matches(feedbackSourceKey(task.sourceFeedback)),
  ).length;
  if (taskCount > 0) return { kind: 'covered', taskCount };
  return removedSources.some(matches)
    ? { kind: 'dropped' }
    : { kind: 'uncovered' };
}

// A task source may repeat the attribution without the quote marks, such as
// `Quote - Ana, 2026-11-02`. The parser keeps that whole, so it is matched
// against the quote body, any dash, then the attribution. Only that separator
// is loosened, so dashes inside a quote body still have to match exactly.
function sourceMatcher(quote: string): (key: string) => boolean {
  const bodyKey = feedbackSourceKey(quote);
  const { quote: body, attribution } = parseFeedbackQuote(quote);
  if (!attribution) return (key) => key === bodyKey;
  const credit = attribution.date
    ? `${attribution.author}, ${attribution.date}`
    : attribution.author;
  const unquoted = new RegExp(
    `^${escapeRegExp(normalizeFeedbackQuote(body))}\\s*[-–—]\\s*${escapeRegExp(normalizeFeedbackQuote(credit))}$`,
  );
  return (key) => key === bodyKey || unquoted.test(key);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
