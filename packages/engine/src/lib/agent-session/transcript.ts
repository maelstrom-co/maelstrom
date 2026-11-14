import type { Brand, CallId, RunId } from '@maelstrom-co/protocol';
import type { ModelMessage } from '@tanstack/ai';

import { assertNever } from '../assert-never.js';
import type { AgentRunFinished } from './agent-run.js';

/**
 * Names one tool call across the whole session as `<runId>:<callId>`, so a
 * later run can point back at a call an earlier run made.
 */
export type ToolCallRef = Brand<string, 'ToolCallRef'>;

/** Builds the session-wide {@link ToolCallRef} of one call of one run. */
export function toolCallRef(runId: RunId, callId: CallId): ToolCallRef {
  return `${runId}:${callId}` as ToolCallRef;
}

/**
 * The in-memory record of what an Agent Session emitted, rendered into the
 * prior messages of each later run. It keeps tool summaries only, never full
 * tool results, and accepts no identity. It keeps only the most recent runs
 * that fit its character bound, see {@link TranscriptOptions.maxChars}.
 */
export interface Transcript {
  /** Records the utterance that started a run. */
  recordUserInput(runId: RunId, text: string): void;
  /**
   * Records streamed reply text of one model turn. Consecutive fragments of
   * the same turn join into one reply, so text cut short by an abnormal
   * ending stays as it was sent.
   */
  recordMessage(runId: RunId, turnId: string, text: string): void;
  /** Records a tool call the model requested, with the arguments it sent. */
  recordToolCall(
    runId: RunId,
    callId: CallId,
    name: string,
    args: unknown,
  ): void;
  /** Records how a tool call settled, by its user-safe summary. */
  recordToolResult(
    runId: RunId,
    callId: CallId,
    ok: boolean,
    summary: string,
  ): void;
  /**
   * Records a one-line note about a show the run asked the Planner for, such
   * as that it is queued or what the screen then displays. It belongs to the
   * run, so it leaves with that run on eviction.
   */
  recordShowNote(runId: RunId, turnId: string, text: string): void;
  /** Records the closing message a run sent when a budget ran out. */
  recordClosingMessage(runId: RunId, text: string): void;
  /**
   * Records how a run ended. A completed run adds nothing to the rendering.
   * Other endings render with their reason and user-safe fields, never with
   * a cancellation cause.
   */
  recordEnding(runId: RunId, finished: AgentRunFinished): void;
  /**
   * Renders every retained entry, oldest first. User inputs become
   * `user` messages, and so do show notes. Reply text, tool calls, tool summaries, closing messages
   * and abnormal endings become `assistant` content, with consecutive
   * entries of the same role joined by newlines into one message.
   */
  renderPriorMessages(): ModelMessage<string>[];
}

/**
 * Default most rendered characters a {@link Transcript} keeps before evicting
 * its oldest runs.
 */
export const TRANSCRIPT_MAX_CHARS = 64_000;

/** Options of {@link createTranscript}. */
export interface TranscriptOptions {
  /**
   * Most rendered characters to keep across all recorded runs. When the total
   * exceeds it, whole runs leave oldest first, so a run's input, replies,
   * tool calls, tool results and ending always leave together. The newest
   * run is always kept, even when it alone exceeds the bound. Defaults to
   * {@link TRANSCRIPT_MAX_CHARS}.
   */
  readonly maxChars?: number;
}

/** Creates an empty {@link Transcript}. */
export function createTranscript({
  maxChars = TRANSCRIPT_MAX_CHARS,
}: TranscriptOptions = {}): Transcript {
  const entries: TranscriptEntry[] = [];
  const runsWithReplyText = new Set<RunId>();
  let totalChars = 0;

  const append = (entry: TranscriptEntry) => {
    entries.push(entry);
    totalChars += renderEntry(entry).length;
    evictOldestRuns();
  };

  const evictOldestRuns = () => {
    const newestRunId = entries.at(-1)?.runId;
    while (totalChars > maxChars) {
      const oldestRunId = entries[0]?.runId;
      if (oldestRunId === undefined || oldestRunId === newestRunId) return;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.runId !== oldestRunId) continue;
        totalChars -= renderEntry(entry).length;
        entries.splice(index, 1);
      }
      runsWithReplyText.delete(oldestRunId);
    }
  };

  return {
    recordUserInput(runId, text) {
      append({ kind: 'user_input', runId, text });
    },
    recordMessage(runId, turnId, text) {
      if (text.length === 0) return;
      runsWithReplyText.add(runId);
      const last = entries.at(-1);
      if (last?.kind === 'reply_text' && last.turnId === turnId) {
        last.text += text;
        totalChars += text.length;
        evictOldestRuns();
        return;
      }
      append({ kind: 'reply_text', runId, turnId, text });
    },
    recordToolCall(runId, callId, name, args) {
      append({
        kind: 'tool_call',
        runId,
        ref: toolCallRef(runId, callId),
        name,
        args: serializeToolArguments(args),
      });
    },
    recordToolResult(runId, callId, ok, summary) {
      append({
        kind: 'tool_result',
        runId,
        ref: toolCallRef(runId, callId),
        ok,
        summary,
      });
    },
    recordShowNote(runId, turnId, text) {
      append({ kind: 'show_note', runId, turnId, text });
    },
    recordClosingMessage(runId, text) {
      append({ kind: 'closing_message', runId, text });
    },
    recordEnding(runId, finished) {
      const line = describeEnding(
        runId,
        finished,
        runsWithReplyText.has(runId),
      );
      if (line !== undefined) append({ kind: 'ending', runId, line });
    },
    renderPriorMessages() {
      const messages: ModelMessage<string>[] = [];
      for (const entry of entries) {
        const role =
          entry.kind === 'user_input' || entry.kind === 'show_note'
            ? 'user'
            : 'assistant';
        const content = renderEntry(entry);
        const last = messages.at(-1);
        if (last?.role === role) {
          last.content = `${last.content}\n${content}`;
        } else {
          messages.push({ role, content });
        }
      }
      return messages;
    },
  };
}

type TranscriptEntry =
  | {
      readonly kind: 'user_input';
      readonly runId: RunId;
      readonly text: string;
    }
  | {
      readonly kind: 'reply_text';
      readonly runId: RunId;
      readonly turnId: string;
      text: string;
    }
  | {
      readonly kind: 'tool_call';
      readonly runId: RunId;
      readonly ref: ToolCallRef;
      readonly name: string;
      readonly args: string;
    }
  | {
      readonly kind: 'tool_result';
      readonly runId: RunId;
      readonly ref: ToolCallRef;
      readonly ok: boolean;
      readonly summary: string;
    }
  | {
      readonly kind: 'show_note';
      readonly runId: RunId;
      readonly turnId: string;
      readonly text: string;
    }
  | {
      readonly kind: 'closing_message';
      readonly runId: RunId;
      readonly text: string;
    }
  | {
      readonly kind: 'ending';
      readonly runId: RunId;
      readonly line: string;
    };

function renderEntry(entry: TranscriptEntry): string {
  switch (entry.kind) {
    case 'user_input':
    case 'reply_text':
      return entry.text;
    case 'tool_call':
      return `[tool call ${entry.ref}] ${entry.name} ${entry.args}`;
    case 'tool_result':
      return `[tool result ${entry.ref}] ${entry.ok ? 'ok' : 'failed'}: ${entry.summary}`;
    case 'show_note':
      return `[show ${entry.turnId}] ${entry.text}`;
    case 'closing_message':
      return `[closing message ${entry.runId}] ${entry.text}`;
    case 'ending':
      return entry.line;
    default:
      return assertNever(entry, 'transcript entry');
  }
}

function describeEnding(
  runId: RunId,
  finished: AgentRunFinished,
  hasReplyText: boolean,
): string | undefined {
  const partialNote = hasReplyText ? ', reply above is partial' : '';
  switch (finished.reason) {
    case 'completed':
      return undefined;
    case 'budget': {
      const usageNote = finished.usageUnknown ? ', usage unknown' : '';
      return `[run ${runId} ended: budget, limit ${finished.limit}${usageNote}]`;
    }
    case 'error':
      return `[run ${runId} ended: error ${finished.code}, ${finished.error}${partialNote}]`;
    case 'cancelled':
      return `[run ${runId} ended: cancelled${partialNote}]`;
    default:
      return assertNever(finished, 'agent run ending');
  }
}

function serializeToolArguments(args: unknown): string {
  try {
    return JSON.stringify(args) ?? 'null';
  } catch {
    return '"[unserializable arguments]"';
  }
}
