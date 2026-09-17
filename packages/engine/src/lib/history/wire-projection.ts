import type { SessionHistoryEntry } from '@maelstrom-co/protocol';
import { assertNever } from '../assert-never.js';
import { extractUserIntent } from './history-manager.js';
import type { HistoryEntry } from './history-store.js';

/**
 * Project the engine-internal {@link HistoryEntry} into the public wire DTO.
 * Called by `Engine.getHistory` at the wire boundary; lives in its own module
 * so the projection is unit-testable without spinning up a full engine and so
 * `engine.ts` doesn't accumulate per-API DTO mappers as more read methods land.
 *
 * Engine-internal: not exported from the package barrel.
 */
export const toSessionHistoryEntry = (
  entry: HistoryEntry,
): SessionHistoryEntry => {
  switch (entry.kind) {
    case 'injection':
      return {
        kind: 'injection',
        id: entry.input.id,
        sessionId: entry.input.sessionId,
        timestamp: entry.input.timestamp,
        content: entry.input.content,
      };
    case 'turn':
      return {
        kind: 'turn',
        id: entry.input.id,
        sessionId: entry.input.sessionId,
        timestamp: entry.input.timestamp,
        userIntent: extractUserIntent(
          entry.input.request.context.updateReasons,
        ),
        ...(entry.output.response.userMessage?.trim().length && {
          assistantMessage: entry.output.response.userMessage,
        }),
      };
    default:
      // Compile-time exhaustiveness: a future HistoryEntry variant lands in
      // the engine's storage shape but not here, the typecheck fails. At
      // runtime an unknown kind throws via assertNever (caught by
      // Engine.getHistory's projection try/catch and surfaced as a
      // HistoryError with a projection-specific log).
      return assertNever(entry, 'engine.toSessionHistoryEntry');
  }
};
