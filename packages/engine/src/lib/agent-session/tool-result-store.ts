import type { RunId } from '@maelstrom-co/protocol';

import type {
  AgentRunToolPhaseEndedEvent,
  AgentRunToolPhaseResult,
} from './agent-run.js';
import { toolCallRef, type ToolCallRef } from './transcript.js';

/** Most full tool results a {@link ToolResultStore} keeps before evicting the oldest. */
export const TOOL_RESULT_STORE_CAPACITY = 256;

/** A successful tool call kept with the full output the model saw. */
export type StoredToolResult = Extract<AgentRunToolPhaseResult, { ok: true }>;

/**
 * Full outputs of successful tool calls of one Agent Session, kept in memory
 * so a later run can recall a call by its {@link ToolCallRef}. Failed calls
 * are not kept. Only the {@link TOOL_RESULT_STORE_CAPACITY} most recently
 * recorded results stay.
 */
export interface ToolResultStore {
  /** Keeps every successful result of one model turn of the given run. */
  recordToolPhase(runId: RunId, phase: AgentRunToolPhaseEndedEvent): void;
  /** Returns the full result of a call, or `undefined` when it failed, was evicted or never ran. */
  get(ref: ToolCallRef): StoredToolResult | undefined;
}

/** Creates an empty {@link ToolResultStore}. */
export function createToolResultStore(): ToolResultStore {
  const results = new Map<ToolCallRef, StoredToolResult>();

  return {
    recordToolPhase(runId, phase) {
      for (const result of phase.results) {
        if (!result.ok) continue;
        const ref = toolCallRef(runId, result.callId);
        results.delete(ref);
        results.set(ref, result);
        evictOldest(results);
      }
    },
    get(ref) {
      return results.get(ref);
    },
  };
}

function evictOldest(results: Map<ToolCallRef, StoredToolResult>): void {
  while (results.size > TOOL_RESULT_STORE_CAPACITY) {
    const oldest = results.keys().next();
    if (oldest.done) return;
    results.delete(oldest.value);
  }
}
