import * as semver from 'semver';

import type { PromptSource } from './library';

/** Compares two validated prompt sets by stable ID and enforces P0 version rules. */
export function comparePromptSets(
  base: PromptSource[],
  head: PromptSource[],
): string[] {
  const errors: string[] = [];
  const baseById = new Map(base.map((prompt) => [prompt.metadata.id, prompt]));
  const headById = new Map(head.map((prompt) => [prompt.metadata.id, prompt]));

  for (const previous of base) {
    const current = headById.get(previous.metadata.id);
    if (!current) {
      errors.push(`removed prompt ID ${previous.metadata.id}`);
      continue;
    }
    const order = semver.compare(
      current.metadata.prompt_version,
      previous.metadata.prompt_version,
    );
    if (order < 0)
      errors.push(`${current.metadata.id}: prompt_version decreased`);
    if (current.body !== previous.body && order <= 0) {
      errors.push(
        `${current.metadata.id}: body changed without a higher prompt_version`,
      );
    }
  }

  for (const current of head) {
    if (
      !baseById.has(current.metadata.id) &&
      current.metadata.prompt_version !== '1.0.0'
    ) {
      errors.push(`${current.metadata.id}: new prompts must start at 1.0.0`);
    }
  }
  return errors;
}
