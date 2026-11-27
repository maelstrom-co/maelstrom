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
  const wanted = wantedSourceKeys(quote);
  const taskCount = tasks.filter(
    (task) =>
      task.sourceFeedback !== null &&
      wanted.has(unifyDashes(feedbackSourceKey(task.sourceFeedback))),
  ).length;
  if (taskCount > 0) return { kind: 'covered', taskCount };
  return removedSources.some((entry) => wanted.has(unifyDashes(entry)))
    ? { kind: 'dropped' }
    : { kind: 'uncovered' };
}

const DASH_SEPARATOR = /\s*[-–—]\s*/g;

// A task source may repeat the attribution without the quote marks, such as
// `Quote - Ana, 2026-11-02`. The parser keeps that whole, so it is matched
// against the quote body joined to its attribution.
function wantedSourceKeys(quote: string): ReadonlySet<string> {
  const keys = new Set([unifyDashes(feedbackSourceKey(quote))]);
  const { quote: body, attribution } = parseFeedbackQuote(quote);
  if (attribution) {
    const credit = attribution.date
      ? `${attribution.author}, ${attribution.date}`
      : attribution.author;
    keys.add(
      unifyDashes(
        normalizeFeedbackQuote(`${normalizeFeedbackQuote(body)} - ${credit}`),
      ),
    );
  }
  return keys;
}

function unifyDashes(key: string): string {
  return key.replace(DASH_SEPARATOR, ' - ');
}
