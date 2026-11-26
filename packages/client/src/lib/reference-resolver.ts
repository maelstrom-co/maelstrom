/**
 * Default maximum number of valid choices included in a failure message from
 * {@link createReferenceResolver}.
 */
export const DEFAULT_MAX_REFERENCE_CHOICES = 20;

/**
 * Configuration for {@link createReferenceResolver}.
 */
export interface ReferenceResolverOptions<T> {
  /**
   * Items to search, or a zero-argument reader invoked on each
   * {@link ReferenceResolver.resolve} call so the resolver reads live state.
   */
  readonly items: readonly T[] | (() => readonly T[]);
  /** Extracts the item's stable identifier (for example, `"TL-1"` or a SKU). */
  readonly id: (item: T) => string;
  /** Extracts the item's human-facing title or name. */
  readonly title: (item: T) => string;
  /**
   * Formats an item's published or display label.
   *
   * Matched on the exact-label rung and used to list valid choices in failure
   * messages. Defaults to `"<id> <title>"`, falling back to whichever is
   * non-empty.
   */
  readonly label?: (item: T) => string;
  /**
   * Maximum number of valid choices or ambiguous candidates listed in failure
   * messages. Any remaining entries are summarized as `"and N more"`.
   *
   * Defaults to {@link DEFAULT_MAX_REFERENCE_CHOICES}.
   */
  readonly maxChoices?: number;
}

/**
 * Outcome of {@link ReferenceResolver.resolve}.
 */
export type ReferenceResolution<T> =
  | {
      /** A single item matched the reference. */
      readonly kind: 'found';
      /** The resolved item. */
      readonly item: T;
    }
  | {
      /** No item matched the reference. */
      readonly kind: 'not_found';
      /** The trimmed reference that failed to resolve. */
      readonly query: string;
      /** Planner-actionable message naming a bounded list of valid choices. */
      readonly message: string;
    }
  | {
      /** Multiple items matched at the same resolution rung. */
      readonly kind: 'ambiguous';
      /** The trimmed reference that matched multiple items. */
      readonly query: string;
      /** All items that tied at the matching rung, in source order. */
      readonly candidates: readonly T[];
      /** Planner-actionable message listing a bounded list of candidates. */
      readonly message: string;
    };

/**
 * Resolves user- or planner-supplied entity references against a collection.
 *
 * Created by {@link createReferenceResolver}.
 */
export interface ReferenceResolver<T> {
  /**
   * Resolves `reference` through a deterministic matching ladder:
   * exact id, exact label, exact normalized title, forward substring,
   * most-specific reverse substring, and multi-word token match.
   */
  resolve(reference: string): ReferenceResolution<T>;
}

const PUNCTUATION_PATTERN = /["'“”‘’.,!?:]/g;
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Creates a pure, framework-independent resolver that turns an id, published
 * label, or spoken/fuzzy title into a single entity, or returns a
 * planner-actionable failure message listing a bounded set of valid choices.
 *
 * @example
 * ```ts
 * const tasks = createReferenceResolver({
 *   items: () => store.getTasks(),
 *   id: (task) => task.id,
 *   title: (task) => task.title,
 * });
 *
 * const match = tasks.resolve('launch video');
 * if (match.kind === 'found') {
 *   console.log(match.item.id);
 * } else {
 *   return err(new Error(match.message));
 * }
 * ```
 */
export function createReferenceResolver<T>(
  options: ReferenceResolverOptions<T>,
): ReferenceResolver<T> {
  const { items, id, title } = options;
  const formatLabel =
    options.label ?? ((item: T) => defaultLabel(item, id, title));
  const maxChoices = normalizeMaxChoices(options.maxChoices);

  return {
    resolve(reference: string): ReferenceResolution<T> {
      const currentItems = typeof items === 'function' ? items() : items;
      const query = reference.trim();

      if (!query) {
        return notFound(query, currentItems, formatLabel, maxChoices);
      }

      const queryLower = query.toLowerCase();

      const byId = currentItems.filter((item) => {
        const itemId = id(item).trim().toLowerCase();
        return itemId.length > 0 && itemId === queryLower;
      });
      if (byId.length > 0) {
        return settle(byId, query, formatLabel, maxChoices);
      }

      const byLabel = currentItems.filter((item) => {
        const itemLabel = formatLabel(item).trim().toLowerCase();
        return itemLabel.length > 0 && itemLabel === queryLower;
      });
      if (byLabel.length > 0) {
        return settle(byLabel, query, formatLabel, maxChoices);
      }

      const wanted = normalizeText(query);
      if (!wanted) {
        return notFound(query, currentItems, formatLabel, maxChoices);
      }

      const normalized = currentItems.map((item) => ({
        item,
        title: normalizeText(title(item)),
      }));

      const exactTitle = normalized
        .filter((entry) => entry.title.length > 0 && entry.title === wanted)
        .map((entry) => entry.item);
      if (exactTitle.length > 0) {
        return settle(exactTitle, query, formatLabel, maxChoices);
      }

      const forward = normalized
        .filter(
          (entry) => entry.title.length > 0 && entry.title.includes(wanted),
        )
        .map((entry) => entry.item);
      if (forward.length > 0) {
        return settle(forward, query, formatLabel, maxChoices);
      }

      const reverse = mostSpecificReverseMatches(normalized, wanted);
      if (reverse.length > 0) {
        return settle(reverse, query, formatLabel, maxChoices);
      }

      const queryWords = wanted.split(' ');
      if (queryWords.length > 1) {
        const byTokens = normalized
          .filter((entry) => {
            if (entry.title.length === 0) return false;
            const titleWords = new Set(entry.title.split(' '));
            return queryWords.every((word) => titleWords.has(word));
          })
          .map((entry) => entry.item);
        if (byTokens.length > 0) {
          return settle(byTokens, query, formatLabel, maxChoices);
        }
      }

      return notFound(query, currentItems, formatLabel, maxChoices);
    },
  };
}

function defaultLabel<T>(
  item: T,
  id: (item: T) => string,
  title: (item: T) => string,
): string {
  const itemId = id(item).trim();
  const itemTitle = title(item).trim();
  if (itemId && itemTitle) return `${itemId} ${itemTitle}`;
  return itemId || itemTitle;
}

function normalizeMaxChoices(maxChoices: number | undefined): number {
  if (maxChoices === undefined || !Number.isFinite(maxChoices)) {
    return DEFAULT_MAX_REFERENCE_CHOICES;
  }
  return Math.max(1, Math.floor(maxChoices));
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(PUNCTUATION_PATTERN, '')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim();
}

function mostSpecificReverseMatches<T>(
  entries: readonly { readonly item: T; readonly title: string }[],
  wanted: string,
): T[] {
  let maxLength = 0;
  const best: T[] = [];
  for (const entry of entries) {
    if (entry.title.length === 0 || !wanted.includes(entry.title)) continue;
    if (entry.title.length > maxLength) {
      maxLength = entry.title.length;
      best.length = 0;
      best.push(entry.item);
    } else if (entry.title.length === maxLength) {
      best.push(entry.item);
    }
  }
  return best;
}

function settle<T>(
  matches: readonly T[],
  query: string,
  formatLabel: (item: T) => string,
  maxChoices: number,
): ReferenceResolution<T> {
  if (matches.length === 1) {
    return { kind: 'found', item: matches[0] as T };
  }
  return {
    kind: 'ambiguous',
    query,
    candidates: matches,
    message: `"${query}" matches multiple choices: ${formatChoices(matches, formatLabel, maxChoices)}.`,
  };
}

function notFound<T>(
  query: string,
  items: readonly T[],
  formatLabel: (item: T) => string,
  maxChoices: number,
): ReferenceResolution<T> {
  const message =
    items.length === 0
      ? `No match for "${query}". No valid choices are available.`
      : `No match for "${query}". Valid choices: ${formatChoices(items, formatLabel, maxChoices)}.`;
  return { kind: 'not_found', query, message };
}

function formatChoices<T>(
  items: readonly T[],
  formatLabel: (item: T) => string,
  maxChoices: number,
): string {
  const listed = items.slice(0, maxChoices).map(formatLabel);
  const more = items.length - listed.length;
  return more > 0 ? `${listed.join(', ')} and ${more} more` : listed.join(', ');
}
