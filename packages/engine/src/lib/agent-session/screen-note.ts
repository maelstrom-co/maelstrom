/** Most characters a Screen Note, or a Planner question relayed to the model, may take, ellipsis included. */
export const SCREEN_NOTE_MAX_CHARS = 300;

/**
 * Describes a `change_screen` outcome that settled after its run stopped
 * waiting, so a later run learns what happened on screen. Reads
 * `Screen change settled after the run stopped waiting: applied: "<goal>"`.
 *
 * @param summary - The result summary from `describeScreenChangeResult`.
 * Never Planner text.
 */
export function describeLateScreenChange(summary: string): string {
  return capScreenNote(
    `Screen change settled after the run stopped waiting: ${summary}`,
  );
}

/**
 * Caps text at {@link SCREEN_NOTE_MAX_CHARS} characters, ending with an
 * ellipsis when cut.
 */
export function capScreenNote(text: string): string {
  if (text.length <= SCREEN_NOTE_MAX_CHARS) return text;
  return `${text.slice(0, SCREEN_NOTE_MAX_CHARS - 1)}…`;
}
