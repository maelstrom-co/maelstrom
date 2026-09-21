import type { ActionParameterEnumSnapshot } from '@maelstrom-co/engine';
import {
  type ActionParameter,
  sanitizeControlChars,
} from '@maelstrom-co/protocol';

import { MAX_CHOICES } from './questions.js';

/** Options every parameter question carries besides its candidates: stated_elsewhere, not_stated, omit. */
const RESERVED_OPTIONS = 3;
/** Past this many words, every span is too many candidates to offer. */
export const MAX_SPAN_WORDS = 32;
const MAX_SPAN_LENGTH = 8;

/**
 * The enum values a parameter accepts, normalized the way the engine
 * normalizes them for validation: JSON-serialisable values whose JSON type
 * matches the declared type, control characters stripped. Uses the
 * request's snapshot when there is one so the values are exactly those
 * validation accepts.
 */
export function enumValues(
  parameter: ActionParameter,
  snapshot: ActionParameterEnumSnapshot | undefined,
): readonly unknown[] {
  if (snapshot) return snapshot.get(parameter).map((entry) => entry.value);
  const values: unknown[] = [];
  for (const candidate of parameter.enum ?? []) {
    let json: string | undefined;
    try {
      json = JSON.stringify(candidate);
    } catch {
      continue;
    }
    if (json === undefined) continue;
    const value: unknown = JSON.parse(sanitizeControlChars(json));
    if (jsonType(value) === parameter.type) values.push(value);
  }
  return values;
}

/**
 * Values Jev may pick for `parameter`: its enum values, `true`/`false` for a
 * boolean, numbers in the intent for a number, quoted strings or else every
 * 1 to 8 word span of the intent for a string, nothing for an object. When
 * the intent is too long or the candidates would not fit in one question,
 * there are none: Jev then answers `stated_elsewhere` or `not_stated` and the
 * LLM fills the value instead of the whole request being re-planned.
 */
export function parameterCandidates(
  parameter: ActionParameter,
  intent: string,
  enumerated: readonly unknown[],
): readonly unknown[] {
  const candidates = extract(parameter, intent, enumerated);
  return candidates.length > MAX_CHOICES - RESERVED_OPTIONS ? [] : candidates;
}

function extract(
  parameter: ActionParameter,
  intent: string,
  enumerated: readonly unknown[],
): readonly unknown[] {
  if (enumerated.length > 0) return enumerated;
  switch (parameter.type) {
    case 'boolean':
      return [true, false];
    case 'number':
      return [
        ...new Set(
          Array.from(
            intent.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g),
            (match) => Number(match[0]),
          ),
        ),
      ];
    case 'object':
      return [];
    case 'string':
      return stringCandidates(intent);
  }
}

function stringCandidates(intent: string): readonly string[] {
  const quoted = [
    ...new Set(
      Array.from(
        intent.matchAll(/"([^"\n]+)"|“([^”\n]+)”/g),
        (match) => match[1] ?? match[2],
      ),
    ),
  ];
  if (quoted.length > 0) return quoted;
  const words: { readonly start: number; readonly end: number }[] = [];
  for (const match of intent.matchAll(
    /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’.-][\p{L}\p{N}\p{M}]+)*/gu,
  )) {
    if (words.length === MAX_SPAN_WORDS) return [];
    words.push({ start: match.index, end: match.index + match[0].length });
  }
  const spans = new Set<string>();
  for (let length = 1; length <= MAX_SPAN_LENGTH; length++)
    for (let start = 0; start + length <= words.length; start++)
      spans.add(
        intent.slice(words[start].start, words[start + length - 1].end),
      );
  return [...spans];
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
