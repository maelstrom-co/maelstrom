import {
  normalizeFeedbackQuote,
  type ProjectTask,
} from './project-tasks.store';

export type FeedbackCoverage =
  | { readonly kind: 'covered'; readonly taskCount: number }
  | { readonly kind: 'uncovered' }
  | { readonly kind: 'dropped' };

export interface FeedbackAttribution {
  readonly author: string;
  readonly date: string | null;
}

export interface ParsedFeedbackQuote {
  readonly quote: string;
  readonly attribution: FeedbackAttribution | null;
}

/** Whether a feedback paragraph opens with a straight or curly quote mark. */
export function isFeedbackQuote(paragraph: string): boolean {
  return OPENING_QUOTE_MARK.test(paragraph);
}

/**
 * Splits a feedback quote paragraph into its quoted text and optional trailing
 * attribution, such as `"quote" - Name, 2026-11-02`.
 */
export function parseFeedbackQuote(paragraph: string): ParsedFeedbackQuote {
  const trimmed = paragraph.trim();
  const match = ATTRIBUTED_QUOTE.exec(trimmed);
  if (!match) return { quote: trimmed, attribution: null };
  const quote = match[1] as string;
  const attribution = parseAttribution((match[2] as string).trim());
  if (!attribution) return { quote: trimmed, attribution: null };
  return { quote, attribution };
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
  const wantedBody = normalizeQuoteBody(quote);
  const wantedFull = normalizeFeedbackQuote(quote);
  const taskCount = tasks.filter(
    (task) =>
      task.sourceFeedback !== null &&
      normalizeQuoteBody(task.sourceFeedback) === wantedBody,
  ).length;
  if (taskCount > 0) return { kind: 'covered', taskCount };
  const dropped = removedSources.some(
    (entry) =>
      entry === wantedBody ||
      entry === wantedFull ||
      stripNormalizedAttribution(entry) === wantedBody,
  );
  return dropped ? { kind: 'dropped' } : { kind: 'uncovered' };
}

const OPENING_QUOTE_MARK = /^\s*["“]/;
const ATTRIBUTED_QUOTE = /^\s*(["“][\s\S]+["”])\s*[-–—]\s*([^"”]+)$/;
const NORMALIZED_TRAILING_ATTRIBUTION = /["”]\s*[-–—]\s*[^"”]+$/;

function parseAttribution(raw: string): FeedbackAttribution | null {
  const comma = raw.indexOf(',');
  if (comma === -1) {
    const author = raw.trim();
    return author ? { author, date: null } : null;
  }
  const author = raw.slice(0, comma).trim();
  if (!author) return null;
  const date = raw.slice(comma + 1).trim();
  return { author, date: date || null };
}

function normalizeQuoteBody(text: string): string {
  return normalizeFeedbackQuote(parseFeedbackQuote(text).quote);
}

function stripNormalizedAttribution(normalized: string): string {
  return normalizeFeedbackQuote(
    normalized.replace(NORMALIZED_TRAILING_ATTRIBUTION, ''),
  );
}
