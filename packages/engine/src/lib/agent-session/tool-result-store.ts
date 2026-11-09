import type { RunId } from '@maelstrom-co/protocol';

import type {
  AgentRunToolPhaseEndedEvent,
  AgentRunToolPhaseResult,
} from './agent-run.js';
import { toolCallRef, type ToolCallRef } from './transcript.js';

/** Most full tool results a {@link ToolResultStore} keeps before evicting the oldest. */
export const TOOL_RESULT_STORE_CAPACITY = 256;

/**
 * Default most serialized value characters a {@link ToolResultStore} keeps
 * before evicting its oldest results.
 */
export const TOOL_RESULT_STORE_MAX_CHARS = 256_000;

/** A successful tool call kept with the full output the model saw. */
export type StoredToolResult = Extract<AgentRunToolPhaseResult, { ok: true }>;

/**
 * Full outputs of successful tool calls of one Agent Session, kept in memory
 * so a later run can recall a call by its {@link ToolCallRef}. Failed calls
 * are not kept. Only the {@link TOOL_RESULT_STORE_CAPACITY} most recently
 * recorded results stay, and the oldest also leave while their JSON-serialized
 * values exceed the character budget.
 */
export interface ToolResultStore {
  /** Keeps every successful result of one model turn of the given run. */
  recordToolPhase(runId: RunId, phase: AgentRunToolPhaseEndedEvent): void;
  /** Returns the full result of a call, or `undefined` when it failed, was evicted, was not kept or never ran. */
  get(ref: ToolCallRef): StoredToolResult | undefined;
}

/** Options of {@link createToolResultStore}. */
export interface ToolResultStoreOptions {
  /**
   * Most JSON-serialized value characters to keep across all results. When
   * the total exceeds it, results leave oldest first. A result whose value
   * alone exceeds it, or cannot be serialized, is not kept. Defaults to
   * {@link TOOL_RESULT_STORE_MAX_CHARS}.
   */
  readonly maxChars?: number;
}

/** Creates an empty {@link ToolResultStore}. */
export function createToolResultStore({
  maxChars = TOOL_RESULT_STORE_MAX_CHARS,
}: ToolResultStoreOptions = {}): ToolResultStore {
  const results = new Map<ToolCallRef, RetainedToolResult>();
  let totalChars = 0;

  const remove = (ref: ToolCallRef) => {
    const retained = results.get(ref);
    if (retained === undefined) return;
    totalChars -= retained.chars;
    results.delete(ref);
  };

  const evictOldest = () => {
    while (results.size > TOOL_RESULT_STORE_CAPACITY || totalChars > maxChars) {
      const oldest = results.keys().next();
      if (oldest.done) return;
      remove(oldest.value);
    }
  };

  return {
    recordToolPhase(runId, phase) {
      for (const result of phase.results) {
        if (!result.ok) continue;
        const ref = toolCallRef(runId, result.callId);
        remove(ref);
        const chars = serializedLength(result.value);
        if (chars === undefined || chars > maxChars) continue;
        results.set(ref, { result, chars });
        totalChars += chars;
        evictOldest();
      }
    },
    get(ref) {
      return results.get(ref)?.result;
    },
  };
}

interface RetainedToolResult {
  readonly result: StoredToolResult;
  readonly chars: number;
}

function serializedLength(value: unknown): number | undefined {
  try {
    return (JSON.stringify(value) ?? 'null').length;
  } catch {
    return undefined;
  }
}
