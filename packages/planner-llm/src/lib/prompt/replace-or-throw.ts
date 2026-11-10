/**
 * Replaces the first occurrence of `search` in `text`, throwing when `search`
 * is absent so a drifted default prompt fails at module load instead of
 * silently leaving reply instructions in a reply-free prompt.
 */
export function replaceOrThrow(
  text: string,
  search: string,
  replacement: string,
): string {
  if (!text.includes(search)) {
    throw new Error(
      `Reply-free prompt derivation failed: text not found in default prompt: ${JSON.stringify(search)}`,
    );
  }
  return text.replace(search, () => replacement);
}
